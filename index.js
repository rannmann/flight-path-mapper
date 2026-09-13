#!/usr/bin/env node
/**
 * Flight path generator: reads one day of ADS-B Exchange snapshots and
 * writes a GeoJSON FeatureCollection per configured city and radius,
 * one MultiLineString feature per aircraft (hex code).
 *
 *   node index.js [--date YYYY-MM-DD] [--limit N] [--stride K]
 *
 *   --limit N   only read the first N snapshots (after striding)
 *   --stride K  read every K-th snapshot (LIGHTWEIGHT_MODE=true means 2)
 *
 * Snapshots are split into contiguous, time-ordered batches, one per
 * worker thread. Each worker returns per-city/radius path fragments and
 * the main thread concatenates them in batch order, so points stay in
 * time order. Gaps of more than MAX_GAP_S between consecutive points of
 * the same aircraft start a new line part.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const config = require('./config');
const Geo = require('./lib/geo');
const logger = require('./lib/logger');

const MAX_GAP_S = 60;
const COORD_DECIMALS = 5;
const PROGRESS_EVERY = 100;

const CITIES = config.cities;
const RADII = [...config.defaultRadii].sort((a, b) => a - b);
const MAX_RADIUS = RADII[RADII.length - 1];

function parseArgs(argv) {
    const args = { date: config.defaultDate, limit: Infinity, stride: config.processing.lightweightMode ? 2 : 1 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const [flag, inlineValue] = a.includes('=') ? a.split('=', 2) : [a, undefined];
        const value = () => inlineValue !== undefined ? inlineValue : argv[++i];
        if (flag === '--date') args.date = value();
        else if (flag === '--limit') args.limit = parseInt(value(), 10);
        else if (flag === '--stride') args.stride = parseInt(value(), 10);
        else throw new Error(`Unknown argument ${a}`);
    }
    if (!(args.limit > 0)) throw new Error('--limit must be a positive integer');
    if (!(args.stride > 0)) throw new Error('--stride must be a positive integer');
    return args;
}

function round(v) {
    return Number(v.toFixed(COORD_DECIMALS));
}

/** Unix seconds for a snapshot: the file's `now`, else derived from its name. */
function snapshotTime(data, file, date) {
    if (typeof data.now === 'number') return data.now;
    const m = /^(\d{2})(\d{2})(\d{2})Z/.exec(path.basename(file));
    if (!m) return NaN;
    return Date.parse(`${date}T${m[1]}:${m[2]}:${m[3]}Z`) / 1000;
}

function readSnapshot(filePath) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
}

/** Empty {city: {radius: {}}} structure. */
function emptyPaths() {
    const out = {};
    for (const city of Object.keys(CITIES)) {
        out[city] = {};
        for (const radius of RADII) out[city][radius] = {};
    }
    return out;
}

/**
 * Append one aircraft position to every city/radius fragment it falls in.
 * Fragments hold {hex, flight, type, points: [[lon, lat, t], ...]}.
 */
function addPosition(paths, plane, t) {
    const lat = round(plane.lat), lon = round(plane.lon);
    for (const city of Object.keys(CITIES)) {
        const c = CITIES[city];
        if (!Geo.withinBoundingBox(c.lat, c.lon, lat, lon, MAX_RADIUS)) continue;
        const miles = Geo.distanceInMiles(c.lat, c.lon, lat, lon);
        for (const radius of RADII) {
            if (miles > radius) continue;
            const byHex = paths[city][radius];
            let frag = byHex[plane.hex];
            if (!frag) {
                frag = byHex[plane.hex] = {
                    hex: plane.hex,
                    flight: typeof plane.flight === 'string' ? plane.flight.trim() : null,
                    type: plane.t || null,
                    points: []
                };
            }
            const last = frag.points[frag.points.length - 1];
            if (last && last[0] === lon && last[1] === lat) continue; // stationary
            frag.points.push([lon, lat, t]);
        }
    }
}

/** Worker: process a batch of files in order and post the fragments. */
function processBatch({ files, date }) {
    const paths = emptyPaths();
    let skipped = 0;
    files.forEach((file, i) => {
        let data;
        try {
            data = readSnapshot(file);
        } catch (err) {
            skipped++;
            parentPort.postMessage({ type: 'skip', file: path.basename(file), error: err.message });
            return;
        }
        const t = snapshotTime(data, file, date);
        if (Array.isArray(data.aircraft) && Number.isFinite(t)) {
            for (const plane of data.aircraft) {
                if (typeof plane.lat === 'number' && typeof plane.lon === 'number' && plane.hex) {
                    addPosition(paths, plane, t);
                }
            }
        }
        if ((i + 1) % PROGRESS_EVERY === 0) parentPort.postMessage({ type: 'progress', count: PROGRESS_EVERY });
    });
    parentPort.postMessage({ type: 'progress', count: files.length % PROGRESS_EVERY });
    parentPort.postMessage({ type: 'result', paths, skipped });
}

/** Main: merge a worker's fragments into the accumulated paths, in order. */
function mergePaths(into, fragment) {
    for (const city of Object.keys(fragment)) {
        for (const radius of Object.keys(fragment[city])) {
            const dst = into[city][radius];
            for (const [hex, frag] of Object.entries(fragment[city][radius])) {
                const existing = dst[hex];
                if (!existing) {
                    dst[hex] = frag;
                    continue;
                }
                if (!existing.flight && frag.flight) existing.flight = frag.flight;
                if (!existing.type && frag.type) existing.type = frag.type;
                const last = existing.points[existing.points.length - 1];
                let start = 0;
                if (last && frag.points.length && frag.points[0][0] === last[0] && frag.points[0][1] === last[1]) start = 1;
                for (let i = start; i < frag.points.length; i++) existing.points.push(frag.points[i]);
            }
        }
    }
}

/** Split [lon, lat, t] points at time gaps; returns MultiLineString parts. */
function splitAtGaps(points, maxGapS = MAX_GAP_S) {
    const parts = [];
    let part = [];
    let prevT = null;
    for (const [lon, lat, t] of points) {
        if (prevT !== null && t - prevT > maxGapS) {
            if (part.length >= 2) parts.push(part);
            part = [];
        }
        part.push([lon, lat]);
        prevT = t;
    }
    if (part.length >= 2) parts.push(part);
    return parts;
}

function toFeature(frag) {
    const parts = splitAtGaps(frag.points);
    if (parts.length === 0) return null;
    return {
        type: 'Feature',
        properties: { hex: frag.hex, flight: frag.flight, type: frag.type },
        geometry: { type: 'MultiLineString', coordinates: parts }
    };
}

function runWorker(batch, onMessage) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: batch });
        let result = null;
        worker.on('message', msg => {
            if (msg.type === 'result') result = msg;
            else onMessage(msg);
        });
        worker.on('error', reject);
        worker.on('exit', code => {
            if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
            else if (!result) reject(new Error('Worker exited without a result'));
            else resolve(result);
        });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const directory = path.join(config.paths.flightHistory, args.date);
    if (!fs.existsSync(directory)) {
        throw new Error(`No snapshots in ${directory}; run "npm run download" first`);
    }
    const files = fs.readdirSync(directory)
        .filter(f => f.endsWith('.json.gz'))
        .sort()
        .filter((f, i) => i % args.stride === 0)
        .slice(0, Number.isFinite(args.limit) ? args.limit : undefined)
        .map(f => path.join(directory, f));
    if (files.length === 0) throw new Error(`No .json.gz snapshots found in ${directory}`);

    const workers = Math.min(config.processing.workerThreads, files.length);
    const batchSize = Math.ceil(files.length / workers);
    const batches = [];
    for (let i = 0; i < files.length; i += batchSize) {
        batches.push({ files: files.slice(i, i + batchSize), date: args.date });
    }
    logger.info('Generating flight paths', {
        date: args.date, snapshots: files.length, stride: args.stride, workers: batches.length,
        cities: Object.keys(CITIES).length, radii: RADII
    });

    let done = 0, skipped = 0;
    const onMessage = msg => {
        if (msg.type === 'progress') {
            done += msg.count;
            if (msg.count > 0) logger.progress(done, files.length, 'Snapshots');
        } else if (msg.type === 'skip') {
            skipped++;
            logger.warn(`Skipping unreadable snapshot ${msg.file}`, { error: msg.error });
        }
    };
    const results = await Promise.all(batches.map(b => runWorker(b, onMessage)));

    const merged = emptyPaths();
    for (const r of results) mergePaths(merged, r.paths); // batches are in time order

    fs.mkdirSync(config.paths.flightPaths, { recursive: true });
    const metadata = { generated: new Date().toISOString(), date: args.date, files: [] };
    for (const city of Object.keys(CITIES)) {
        for (const radius of RADII) {
            const features = Object.values(merged[city][radius]).map(toFeature).filter(Boolean);
            const file = `${city}_${radius}_miles.json`;
            fs.writeFileSync(path.join(config.paths.flightPaths, file), JSON.stringify({
                type: 'FeatureCollection',
                features
            }));
            metadata.files.push({ file, city, radius, features: features.length });
            logger.info(`Wrote ${file}`, { features: features.length });
        }
    }
    fs.writeFileSync(path.join(config.paths.flightPaths, 'metadata.json'), JSON.stringify(metadata, null, 2));
    logger.info('Flight paths finished', { outputs: metadata.files.length, skippedSnapshots: skipped });
}

if (!isMainThread) {
    processBatch(workerData);
} else if (require.main === module) {
    main().catch(err => {
        logger.error('Flight path generation failed', { error: err.message });
        process.exit(1);
    });
}

module.exports = { parseArgs, splitAtGaps, toFeature, mergePaths, addPosition, emptyPaths, snapshotTime };
