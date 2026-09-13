#!/usr/bin/env node
/**
 * Render the sparse global noise grid (data/noise/<date>/*.tiles) into
 * Web Mercator greyscale PNG metatiles for static hosting.
 *
 * Output: data/tiles/<layer>/<z>/<mx>_<my>.png and data/tiles/meta.json.
 * Each metatile packs M x M standard 256 px XYZ tiles (M = min(8, 2^z)),
 * so a metatile is 256*M px square and mx = floor(x / M), my = floor(y / M).
 * Metatiles that would be entirely zero are not written; the client treats
 * a 404 as "no data".
 *
 * Pixels store encoded values, not colours (see lib/noise/dnl.js):
 *   dnl      v = round((dB - DB_OFFSET) / DB_STEP), 0 = below cutoff
 *   traffic  v = round(40 * log10(1 + seconds)),    0 = no traffic
 *
 * Usage:
 *   node scripts/render-tiles.js [--in data/noise/<date>] [--out data/tiles]
 *                                [--layers dnl,traffic] [--max-zoom 8]
 */
const fs = require('fs');
const path = require('path');
const {
    ROWS, TILE, TILE_COLS, CELL_DEG, tileRowFromId, tileColFromId, TileStore
} = require('../lib/noise/grid');
const {
    CUTOFF_DB, DB_OFFSET, DB_STEP, energyToDb, encodeDb, decodeDb,
    encodeTraffic, decodeTraffic
} = require('../lib/noise/dnl');
const { encodeGray } = require('../lib/noise/png');

const TILE_SIZE = 256;
const META_TILE_SIZE = 8;               // tiles per metatile side (max)
const MAX_LAT = 85.0511287798;          // Web Mercator latitude limit
const LAYERS = ['dnl', 'traffic', 'above45'];
const SECONDS_LAYERS = new Set(['traffic', 'above45']); // seconds per cell, log40 encoded, area-diluted
const DEFAULT_MAX_ZOOM = 8;
const ROOT = path.resolve(__dirname, '..');

const LAYER_META = {
    dnl: { encoding: 'db', offset: DB_OFFSET, step: DB_STEP, cutoffDb: CUTOFF_DB },
    traffic: { encoding: 'log40' },
    above45: { encoding: 'log40', thresholdDb: 45, unit: 'seconds per day with at least one aircraft at or above thresholdDb' }
};

/** Pixel y (0..worldPx) of a latitude at a zoom whose world is worldPx wide. */
function latToY(lat, worldPx) {
    if (lat > MAX_LAT) lat = MAX_LAT;
    else if (lat < -MAX_LAT) lat = -MAX_LAT;
    const phi = lat * Math.PI / 180;
    let y = worldPx * (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI));
    return y < 0 ? 0 : y > worldPx ? worldPx : y;
}

function lonToX(lon, worldPx) {
    return (lon + 180) / 360 * worldPx;
}

/**
 * Pixel y of every grid row edge at this zoom: rowY[r] is the top edge of
 * row r, rowY[r + 1] its bottom edge. Monotonic non-decreasing; rows beyond
 * +/-MAX_LAT collapse to zero height.
 */
function buildRowEdges(worldPx) {
    const rowY = new Float64Array(ROWS + 1);
    for (let r = 0; r <= ROWS; r++) rowY[r] = latToY(90 - r * CELL_DEG, worldPx);
    return rowY;
}

/** First index i in [0, n) with arr[i] > v (arr non-decreasing). */
function upperBound(arr, n, v) {
    let lo = 0, hi = n;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] > v) hi = mid; else lo = mid + 1;
    }
    return lo;
}

/** First index i in [0, n) with arr[i] >= v (arr non-decreasing). */
function lowerBound(arr, n, v) {
    let lo = 0, hi = n;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] >= v) hi = mid; else lo = mid + 1;
    }
    return lo;
}

/** Newest date directory under data/noise. */
function newestNoiseDir(noiseRoot) {
    if (!fs.existsSync(noiseRoot)) return null;
    const dirs = fs.readdirSync(noiseRoot)
        .filter(d => fs.statSync(path.join(noiseRoot, d)).isDirectory())
        .sort();
    return dirs.length ? path.join(noiseRoot, dirs[dirs.length - 1]) : null;
}

/** Load every `<layer>.<k>.tiles` file of a layer into one TileStore. */
function loadLayer(inDir, layer) {
    const re = new RegExp(`^${layer}\\.(\\d+)\\.tiles$`);
    const files = fs.readdirSync(inDir).filter(f => re.test(f)).sort();
    const store = new TileStore();
    for (const f of files) store.addBuffer(fs.readFileSync(path.join(inDir, f)));
    return { store, files };
}

/** Sorted (by id) parallel arrays of tile ids and their data. */
function sortedTiles(store) {
    const ids = Uint32Array.from(store.tiles.keys()).sort();
    const tiles = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) tiles[i] = store.tiles.get(ids[i]);
    return { ids, tiles };
}

/**
 * Render one zoom level of one layer. Returns the number of metatiles
 * written and the encoded min/max present in them.
 */
function renderZoom({ ids, tiles, zoom, layer, layerDir, encode, dilute = false }) {
    const n = 1 << zoom;                             // tiles per axis
    const worldPx = n * TILE_SIZE;
    const M = Math.min(META_TILE_SIZE, n);           // tiles per metatile side
    const metaPx = M * TILE_SIZE;                    // metatile side in px
    const metaShift = Math.log2(metaPx) | 0;         // px -> metatile index
    const metaCount = n / M;                         // metatiles per axis
    const pxPerCell = worldPx / 360 * CELL_DEG;      // cell width in px (lon is linear)
    const rowY = buildRowEdges(worldPx);
    const tileCount = ids.length;

    const zoomDir = path.join(layerDir, String(zoom));
    let written = 0, encMin = 256, encMax = 0;

    const sums = new Array(metaCount).fill(null);
    const wts = new Array(metaCount).fill(null);
    const pixels = new Uint8Array(metaPx * metaPx);

    for (let my = 0; my < metaCount; my++) {
        const by0 = my * metaPx, by1 = by0 + metaPx;   // band pixel rows [by0, by1)

        // Grid rows intersecting this band: rowY[row+1] > by0 and rowY[row] < by1.
        // rowY[0] = 0 and rowY[ROWS] = worldPx, so both land inside [0, ROWS).
        const rMin = upperBound(rowY, ROWS + 1, by0) - 1;
        const rMax = lowerBound(rowY, ROWS + 1, by1) - 1;
        if (rMin > rMax) continue;
        const tileRowMin = (rMin / TILE) | 0, tileRowMax = (rMax / TILE) | 0;
        const idStart = tileRowMin * TILE_COLS, idEnd = (tileRowMax + 1) * TILE_COLS;
        const iStart = lowerBound(ids, tileCount, idStart);
        const iEnd = lowerBound(ids, tileCount, idEnd);

        let touched = false;
        for (let i = iStart; i < iEnd; i++) {
            const id = ids[i];
            const tile = tiles[i];
            const tileRow = tileRowFromId(id), tileCol = tileColFromId(id);
            const rowBase = tileRow * TILE, colBase = tileCol * TILE;
            const rLo = Math.max(rMin, rowBase), rHi = Math.min(rMax, rowBase + TILE - 1);

            for (let row = rLo; row <= rHi; row++) {
                // Vertical extent of this row clipped to the band.
                let cy0 = rowY[row], cy1 = rowY[row + 1];
                if (cy0 < by0) cy0 = by0;
                if (cy1 > by1) cy1 = by1;
                if (cy1 <= cy0) continue;
                const pyStart = cy0 | 0;
                const base = (row - rowBase) * TILE;

                for (let c = 0; c < TILE; c++) {
                    const v = tile[base + c];
                    if (!(v > 0)) continue;
                    const col = colBase + c;
                    const x0 = col * pxPerCell, x1 = x0 + pxPerCell;
                    let px = x0 | 0;
                    if (px >= worldPx) continue;
                    touched = true;
                    for (; px < x1 && px < worldPx; px++) {
                        const ox = (x1 < px + 1 ? x1 : px + 1) - (x0 > px ? x0 : px);
                        if (ox <= 0) continue;
                        const mx = px >> metaShift;
                        let s = sums[mx], w = wts[mx];
                        if (s === null) {
                            s = sums[mx] = new Float64Array(metaPx * metaPx);
                            w = wts[mx] = new Float64Array(metaPx * metaPx);
                        }
                        const lx = px - (mx << metaShift);
                        for (let py = pyStart; py < cy1; py++) {
                            const oy = (cy1 < py + 1 ? cy1 : py + 1) - (cy0 > py ? cy0 : py);
                            if (oy <= 0) continue;
                            const a = ox * oy;
                            const idx = (py - by0) * metaPx + lx;
                            s[idx] += v * a;
                            w[idx] += a;
                        }
                    }
                }
            }
        }
        if (!touched) continue;

        // Encode and write every metatile touched in this band.
        for (let mx = 0; mx < metaCount; mx++) {
            const s = sums[mx];
            if (s === null) continue;
            const w = wts[mx];
            let any = false;
            for (let k = 0; k < s.length; k++) {
                const wk = w[k];
                if (wk > 0) {
                    // Weights are px^2 of overlap, so a fully covered pixel has wk = 1.
                    // Diluted layers average over the whole pixel (empty cells count as 0)
                    // so sparse coverage fades out at low zoom instead of lighting up pixels.
                    const e = encode(s[k] / (dilute && wk < 1 ? 1 : wk));
                    pixels[k] = e;
                    if (e > 0) {
                        any = true;
                        if (e < encMin) encMin = e;
                        if (e > encMax) encMax = e;
                    }
                } else {
                    pixels[k] = 0;
                }
            }
            sums[mx] = null;
            wts[mx] = null;
            if (!any) continue;
            if (written === 0) fs.mkdirSync(zoomDir, { recursive: true });
            fs.writeFileSync(path.join(zoomDir, `${mx}_${my}.png`), encodeGray(pixels, metaPx, metaPx));
            written++;
        }
    }
    return { written, encMin: encMin > encMax ? null : encMin, encMax: encMin > encMax ? null : encMax };
}

function encodeForLayer(layer) {
    if (layer === 'dnl') return mean => encodeDb(energyToDb(mean));
    if (SECONDS_LAYERS.has(layer)) return mean => encodeTraffic(mean);
    throw new Error(`unknown layer: ${layer}`);
}

function decodeForLayer(layer) {
    return layer === 'dnl' ? decodeDb : decodeTraffic; // every non-dB layer is log40 seconds
}

/**
 * Render metatiles for the given layers.
 * options: { inDir, outDir, layers, maxZoom, log }
 * Returns the meta.json object that was written.
 */
function render(options = {}) {
    const inDir = options.inDir || newestNoiseDir(path.join(ROOT, 'data', 'noise'));
    if (!inDir || !fs.existsSync(inDir)) throw new Error(`input directory not found: ${inDir}`);
    const outDir = options.outDir || path.join(ROOT, 'data', 'tiles');
    const layers = options.layers || LAYERS;
    const maxZoom = options.maxZoom === undefined ? DEFAULT_MAX_ZOOM : options.maxZoom;
    const log = options.log === false ? () => {} : (options.log || console.log);
    for (const l of layers) if (!LAYER_META[l]) throw new Error(`unknown layer: ${l}`);

    const manifestPath = path.join(inDir, 'manifest.json');
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
    // A merged multi-day grid (scripts/merge-noise.js) has `dates` and no single `date`.
    const dates = Array.isArray(manifest.dates) && manifest.dates.length ? manifest.dates.slice() : null;
    const date = manifest.date || (dates ? null : path.basename(inDir));
    const label = manifest.label || date || (dates ? `${dates.length} days, ${dates[0]} to ${dates[dates.length - 1]}` : path.basename(inDir));

    // Keep entries for layers that are not being re-rendered.
    const metaPath = path.join(outDir, 'meta.json');
    let previousLayers = {};
    if (fs.existsSync(metaPath)) {
        try { previousLayers = JSON.parse(fs.readFileSync(metaPath, 'utf8')).layers || {}; } catch (e) { /* ignore */ }
    }

    const layerResults = {};
    for (const layer of layers) {
        const layerDir = path.join(outDir, layer);
        fs.rmSync(layerDir, { recursive: true, force: true });
        fs.mkdirSync(layerDir, { recursive: true });

        const t0 = Date.now();
        const { store, files } = loadLayer(inDir, layer);
        const { ids, tiles } = sortedTiles(store);
        store.tiles.clear();
        let cells = 0;
        for (const t of tiles) for (let k = 0; k < t.length; k++) if (t[k] > 0) cells++;
        log(`[${layer}] loaded ${ids.length} grid tiles (${cells} non-zero cells) from ${files.length} file(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

        const encode = encodeForLayer(layer);
        const decode = decodeForLayer(layer);
        let total = 0, encMin = null, encMax = null;
        for (let zoom = 0; zoom <= maxZoom; zoom++) {
            const tz = Date.now();
            const r = renderZoom({ ids, tiles, zoom, layer, layerDir, encode, dilute: SECONDS_LAYERS.has(layer) });
            total += r.written;
            if (zoom === maxZoom) { encMin = r.encMin; encMax = r.encMax; }
            log(`[${layer}] z${zoom}: ${r.written} metatile(s) in ${((Date.now() - tz) / 1000).toFixed(1)}s`);
        }
        layerResults[layer] = {
            ...LAYER_META[layer],
            minValue: encMin === null ? null : decode(encMin),
            maxValue: encMax === null ? null : decode(encMax),
            metatiles: total
        };
    }

    const meta = {
        generatedAt: new Date().toISOString(),
        date,
        dates: dates || (date ? [date] : []),
        days: dates ? dates.length : (date ? 1 : 0),
        label,
        tileSize: TILE_SIZE,
        metaTileSize: META_TILE_SIZE,
        maxZoom,
        layers: { ...previousLayers, ...layerResults },
        stats: manifest.stats || null,
        source: 'ADS-B Exchange samples'
    };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    log(`wrote ${metaPath}`);
    return meta;
}

function parseArgs(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) throw new Error(`missing value for ${a}`);
            return argv[++i];
        };
        if (a === '--in') opts.inDir = path.resolve(next());
        else if (a === '--out') opts.outDir = path.resolve(next());
        else if (a === '--layers') opts.layers = next().split(',').map(s => s.trim()).filter(Boolean);
        else if (a === '--max-zoom') {
            opts.maxZoom = parseInt(next(), 10);
            if (!Number.isInteger(opts.maxZoom) || opts.maxZoom < 0) throw new Error('--max-zoom must be a non-negative integer');
        } else if (a === '--help' || a === '-h') {
            opts.help = true;
        } else {
            throw new Error(`unknown argument: ${a}`);
        }
    }
    return opts;
}

function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exit(2);
    }
    if (opts.help) {
        console.log('usage: node scripts/render-tiles.js [--in data/noise/<date>] [--out data/tiles] [--layers dnl,traffic] [--max-zoom 8]');
        return;
    }
    const t0 = Date.now();
    try {
        render(opts);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (require.main === module) main();

module.exports = { render, latToY, lonToX, MAX_LAT, TILE_SIZE, META_TILE_SIZE };
