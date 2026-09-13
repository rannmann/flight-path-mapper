#!/usr/bin/env node
/**
 * Downloads one day of ADS-B Exchange readsb-hist snapshots (5 s interval,
 * ~17,280 gzip files) into data/flight-history/<date>/, or with --terrain
 * the ETOPO DEM and OurAirports inputs into data/terrain/.
 *
 *   node download.js [--date YYYY-MM-DD] [--verify]
 *   node download.js --terrain
 *
 * The samples site has no directory listing any more, so the snapshot
 * names are generated (HHMMSSZ.json.gz every 5 s) and a 404 is treated as
 * a gap in the archive, not as a failure. Files are stored exactly as the
 * server sends them (gzip); the transfer must not be transparently
 * decompressed, hence `decompress: false` below.
 *
 * --verify re-checks every existing snapshot with gunzip and re-downloads
 * the ones that fail (the default only trusts that the file is non-empty).
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const pLimit = require('p-limit');
const config = require('./config');
const logger = require('./lib/logger');

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 1500;
const PROGRESS_EVERY = 200;

function parseArgs(argv) {
    const args = { terrain: false, verify: false, date: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--terrain') args.terrain = true;
        else if (a === '--verify') args.verify = true;
        else if (a === '--date') args.date = argv[++i];
        else if (a.startsWith('--date=')) args.date = a.slice(7);
        else throw new Error(`Unknown argument ${a}`);
    }
    return args;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Snapshot file names of one day: 000000Z.json.gz .. 235955Z.json.gz. */
function snapshotNames(intervalSec = 5) {
    const names = [];
    for (let s = 0; s < 86400; s += intervalSec) {
        const hh = String(Math.floor(s / 3600)).padStart(2, '0');
        const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        names.push(`${hh}${mm}${ss}Z.json.gz`);
    }
    return names;
}

class NotFoundError extends Error {}

/** Failed downloads a day may have before the run counts as failed: 1 %, at least 5. */
function tolerableFailures(total) {
    return Math.max(5, Math.floor(total * 0.01));
}

/**
 * Stream a URL to disk via a temporary .part file. With `raw`, ask for gzip
 * and keep the bytes as served (for .gz archives); otherwise let axios
 * decompress like a browser would.
 */
async function streamToFile(url, outputPath, raw = false) {
    const tmp = `${outputPath}.part`;
    const response = await axios({
        url, method: 'GET', responseType: 'stream', timeout: 120000,
        decompress: !raw,
        headers: raw ? { 'Accept-Encoding': 'gzip' } : {},
        validateStatus: null
    });
    if (response.status === 404) { response.data.resume(); throw new NotFoundError(`404 ${url}`); }
    if (response.status < 200 || response.status >= 300) { response.data.resume(); throw new Error(`HTTP ${response.status} ${url}`); }
    try {
        await pipeline(response.data, fs.createWriteStream(tmp));
        fs.renameSync(tmp, outputPath);
    } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
    }
}

function gzipIsReadable(filePath) {
    try {
        zlib.gunzipSync(fs.readFileSync(filePath));
        return true;
    } catch (err) {
        return false;
    }
}

function isNonEmptyFile(filePath) {
    try {
        return fs.statSync(filePath).size > 0;
    } catch (err) {
        return false;
    }
}

/**
 * Download with retries. `verify(path)` runs after each attempt; a false
 * result deletes the file and counts as a failure.
 */
async function downloadWithRetry(url, outputPath, verify = null, raw = false) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await streamToFile(url, outputPath, raw);
            if (verify && !verify(outputPath)) {
                fs.rmSync(outputPath, { force: true });
                throw new Error('verification failed (not a readable gzip)');
            }
            return true;
        } catch (err) {
            if (err instanceof NotFoundError) return null; // gap in the archive, no retry
            lastError = err;
            if (attempt < MAX_ATTEMPTS) {
                const wait = BACKOFF_MS * Math.pow(2, attempt - 1);
                logger.warn(`Retrying ${path.basename(outputPath)} in ${wait} ms`, { attempt, error: err.message });
                await sleep(wait);
            }
        }
    }
    logger.error(`Giving up on ${path.basename(outputPath)}`, { error: lastError && lastError.message });
    return false;
}

async function downloadSnapshots(date, verifyExisting) {
    const datePath = config.adsbExchange.getDatePath(date);
    const baseUrl = `${config.adsbExchange.baseUrl}/${datePath}/`;
    const outputDir = path.join(config.paths.flightHistory, date);
    fs.mkdirSync(outputDir, { recursive: true });

    const files = snapshotNames();
    logger.info(`Fetching up to ${files.length} snapshots`, { date, baseUrl, outputDir });

    const limit = pLimit(config.processing.concurrencyLimit);
    const stats = { downloaded: 0, skipped: 0, missing: 0, failed: 0, done: 0 };

    await Promise.all(files.map(file => limit(async () => {
        const outputPath = path.join(outputDir, file);
        const complete = verifyExisting ? gzipIsReadable(outputPath) : isNonEmptyFile(outputPath);
        if (complete) {
            stats.skipped++;
        } else {
            if (fs.existsSync(outputPath)) {
                logger.warn(`Replacing incomplete file ${file}`);
                fs.rmSync(outputPath, { force: true });
            }
            const ok = await downloadWithRetry(baseUrl + file, outputPath, gzipIsReadable, true);
            if (ok) stats.downloaded++; else if (ok === null) stats.missing++; else stats.failed++;
        }
        stats.done++;
        if (stats.done % PROGRESS_EVERY === 0 || stats.done === files.length) {
            logger.progress(stats.done, files.length, 'Snapshots');
        }
    })));

    logger.info('Snapshot download finished', stats);
    if (stats.downloaded + stats.skipped === 0) throw new Error(`No snapshots available at ${baseUrl}`);
    // A few failures are a gap the generator can live with; a lot means something is wrong.
    if (stats.failed > tolerableFailures(files.length)) {
        logger.error(`${stats.failed} snapshots failed to download; rerun to retry them`);
        process.exitCode = 1;
    } else if (stats.failed > 0) {
        logger.warn(`${stats.failed} snapshot(s) failed to download; rerun to retry them`);
    }
    return stats;
}

async function downloadTerrain() {
    const outputDir = config.paths.terrain;
    fs.mkdirSync(outputDir, { recursive: true });
    for (const url of config.terrain.sources) {
        const name = path.basename(new URL(url).pathname);
        const outputPath = path.join(outputDir, name);
        if (isNonEmptyFile(outputPath)) {
            logger.info(`Already present, skipping ${name}`);
            continue;
        }
        logger.info(`Downloading ${name} (this can take a while)`, { url });
        const ok = await downloadWithRetry(url, outputPath);
        if (!ok) process.exitCode = 1;
        else logger.info(`Saved ${name}`, { bytes: fs.statSync(outputPath).size });
    }
    logger.info('Terrain inputs ready; next: npm run terrain');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.terrain) {
        await downloadTerrain();
    } else {
        await downloadSnapshots(args.date || config.defaultDate, args.verify);
    }
}

if (require.main === module) {
    main().catch(err => {
        logger.error('Download failed', { error: err.message });
        process.exit(1);
    });
}

module.exports = { snapshotNames, tolerableFailures, parseArgs, gzipIsReadable, downloadSnapshots };
