#!/usr/bin/env node
/**
 * Average several days of noise grids into one.
 *
 *   node scripts/merge-noise.js --dates 2025-10-01,2025-11-01,... [--in data/noise] [--out data/noise/merged]
 *
 * Every layer is a linear per-day quantity (DNL energy, seconds of
 * presence, seconds above threshold), so the multi-day value is simply the
 * sum over days divided by the number of days: the DNL of the averaged
 * energy is the multi-day DNL, and the two seconds layers become average
 * seconds per day. Layers are merged one at a time to keep memory at a
 * few GB. The output manifest lists the dates so the renderer and the site
 * can label the result.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const grid = require(path.join(ROOT, 'lib', 'noise', 'grid'));

const LAYERS = ['dnl', 'traffic', 'above45'];

function parseArgs(argv) {
    const args = { dates: [], in: path.join(ROOT, 'data', 'noise'), out: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--dates') args.dates = next().split(',').map(s => s.trim()).filter(Boolean);
        else if (a === '--in') args.in = path.resolve(next());
        else if (a === '--out') args.out = path.resolve(next());
        else throw new Error(`Unknown argument ${a}`);
    }
    if (!args.out) args.out = path.join(args.in, 'merged');
    return args;
}

/** Dated directories under `inDir` that have a manifest (all of them if `dates` is empty). */
function resolveDays(inDir, dates) {
    const wanted = dates.length ? dates : fs.readdirSync(inDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return wanted.map(date => {
        const dir = path.join(inDir, date);
        const manifestPath = path.join(dir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) throw new Error(`no manifest for ${date} (${manifestPath}); generate it first`);
        return { date, dir, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
    });
}

function layerFiles(dir, layer) {
    const re = new RegExp(`^${layer}\\.(\\d+)\\.tiles$`);
    return fs.readdirSync(dir).filter(f => re.test(f)).sort().map(f => path.join(dir, f));
}

function sumStats(days) {
    const out = {};
    for (const d of days) {
        for (const [k, v] of Object.entries(d.manifest.stats || {})) {
            if (typeof v === 'number') out[k] = (out[k] || 0) + v;
        }
    }
    return out;
}

/**
 * options: { dates, inDir, outDir, layers, log }
 * Returns the manifest written to outDir.
 */
function merge(options = {}) {
    const inDir = options.inDir || path.join(ROOT, 'data', 'noise');
    const outDir = options.outDir || path.join(inDir, 'merged');
    const layers = options.layers || LAYERS;
    const log = options.log === false ? () => {} : (options.log || console.log);
    const days = resolveDays(inDir, options.dates || []);
    if (days.length === 0) throw new Error('no days to merge');
    if (path.resolve(outDir) === path.resolve(inDir)) throw new Error('output must be a sub-directory');

    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) if (f.endsWith('.tiles')) fs.unlinkSync(path.join(outDir, f));

    const tilesPerLayer = {};
    for (const layer of layers) {
        const t0 = Date.now();
        const store = new grid.TileStore();
        let used = 0;
        for (const day of days) {
            const files = layerFiles(day.dir, layer);
            if (files.length === 0) { log(`warning: ${day.date} has no ${layer} grid; counted as a silent day`); continue; }
            for (const f of files) store.addBuffer(fs.readFileSync(f));
            used++;
        }
        store.scale(1 / days.length);
        fs.writeFileSync(path.join(outDir, `${layer}.0.tiles`), store.toBuffer());
        tilesPerLayer[layer] = store.tiles.size;
        log(`[${layer}] merged ${used}/${days.length} day(s), ${store.tiles.size} grid tiles in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        store.tiles.clear();
    }

    const first = days[0].manifest;
    const dates = days.map(d => d.date);
    const manifest = {
        date: null,
        dates,
        days: days.length,
        label: days.length === 1 ? dates[0] : `${days.length} days, ${dates[0]} to ${dates[dates.length - 1]}`,
        generatedAt: new Date().toISOString(),
        cutoffDb: first.cutoffDb,
        intervalSec: first.intervalSec,
        files: days.reduce((n, d) => n + (d.manifest.files || 0), 0),
        stride: first.stride,
        layers,
        timeAboveDb: first.timeAboveDb,
        perDay: days.map(d => ({ date: d.date, files: d.manifest.files, generatedAt: d.manifest.generatedAt })),
        stats: { ...sumStats(days), tiles: tilesPerLayer.dnl || null }
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    log(`wrote ${path.join(outDir, 'manifest.json')} (${manifest.label})`);
    return manifest;
}

module.exports = { merge, parseArgs, resolveDays, LAYERS };

if (require.main === module) {
    try {
        const args = parseArgs(process.argv.slice(2));
        merge({ dates: args.dates, inDir: args.in, outDir: args.out });
    } catch (err) {
        console.error(`merge-noise failed: ${err.message}`);
        process.exit(1);
    }
}
