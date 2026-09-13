#!/usr/bin/env node
/**
 * Generate the global DNL energy grid and traffic density grid from one
 * day of ADS-B Exchange snapshots.
 *
 *   node scripts/generate-noise.js [--date YYYY-MM-DD] [--workers N]
 *        [--stride K] [--limit N] [--in data/flight-history] [--out data/noise]
 *        [--terrain data/terrain] [--cutoff 35]
 *
 * Time-partitioned worker threads: worker k processes a contiguous run of
 * snapshots (in time order) over the whole globe. Every FLUSH_FILES files
 * it hands its sparse tiles to the main thread (zero-copy transfer), which
 * sums them into the single global grid, so memory stays at roughly one
 * copy of the grid. Parsing each snapshot once is what makes this fast;
 * the physics loop itself is cheap.
 *
 * Output: <out>/<date>/dnl.0.tiles, traffic.0.tiles, above45.0.tiles
 * (TileStore buffers, see lib/noise/grid.js) and manifest.json.
 * above45 holds seconds per cell during which at least one aircraft is
 * received at TIME_ABOVE_DB or louder.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'config'));
const grid = require(path.join(ROOT, 'lib', 'noise', 'grid'));
const { Terrain } = require(path.join(ROOT, 'lib', 'noise', 'terrain'));
const { normalize, Tracker } = require(path.join(ROOT, 'lib', 'noise', 'observations'));
const { createDepositor } = require(path.join(ROOT, 'lib', 'noise', 'deposit'));
const { nightWeight, CUTOFF_DB } = require(path.join(ROOT, 'lib', 'noise', 'dnl'));

const FLUSH_FILES = 100; // worker hands tiles to main every N files
const TIME_ABOVE_DB = 45; // threshold of the time-above layer

function parseArgs(argv) {
    const args = {
        date: config.defaultDate,
        workers: Math.max(1, (config.processing && config.processing.workerThreads) || os.cpus().length - 2),
        stride: 1,
        limit: 0,
        in: (config.paths && config.paths.flightHistory) || 'data/flight-history',
        out: (config.paths && config.paths.noise) || 'data/noise',
        terrain: (config.paths && config.paths.terrain) || 'data/terrain',
        cutoff: CUTOFF_DB
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--date') args.date = next();
        else if (a === '--workers') args.workers = parseInt(next(), 10);
        else if (a === '--stride') args.stride = parseInt(next(), 10);
        else if (a === '--limit') args.limit = parseInt(next(), 10);
        else if (a === '--in') args.in = next();
        else if (a === '--out') args.out = next();
        else if (a === '--terrain') args.terrain = next();
        else if (a === '--cutoff') args.cutoff = parseFloat(next());
        else if (a === '--help' || a === '-h') {
            console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
            process.exit(0);
        }
    }
    return args;
}

function listSnapshots(dir, stride, limit) {
    let files = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort();
    if (stride > 1) files = files.filter((_, i) => i % stride === 0);
    if (limit > 0) files = files.slice(0, limit);
    return files.map(f => path.join(dir, f));
}

// ---------------------------------------------------------------- main
async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const inDir = path.resolve(ROOT, args.in, args.date);
    if (!fs.existsSync(inDir)) {
        console.error(`Snapshot directory not found: ${inDir}`);
        process.exit(1);
    }
    const files = listSnapshots(inDir, args.stride, args.limit);
    if (files.length === 0) {
        console.error('No .json.gz snapshots found');
        process.exit(1);
    }
    const outDir = path.resolve(ROOT, args.out, args.date);
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) if (f.endsWith('.tiles')) fs.unlinkSync(path.join(outDir, f));

    console.log(`Loading terrain...`);
    const terrain = Terrain.load(path.resolve(ROOT, args.terrain));
    console.log(`Snapshots: ${files.length} (stride ${args.stride}), workers: ${args.workers}, cutoff ${args.cutoff} dB`);
    const started = Date.now();

    // Snapshot spacing: seconds of real time each file represents.
    const intervalSec = 5 * args.stride;

    const workers = Math.min(args.workers, files.length);
    const perWorker = Math.ceil(files.length / workers);
    const global = { dnl: new grid.TileStore(), traffic: new grid.TileStore(), above45: new grid.TileStore() };
    const results = await Promise.all(Array.from({ length: workers }, (_, k) => new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
            workerData: {
                files: files.slice(k * perWorker, (k + 1) * perWorker),
                workerIndex: k, workers, outDir, cutoff: args.cutoff, intervalSec,
                terrain: terrain.toTransferable()
            }
        });
        worker.on('message', msg => {
            if (msg.type === 'progress') {
                if (k === 0) {
                    const pct = (100 * msg.done / perWorker).toFixed(0);
                    const rate = msg.done * workers / ((Date.now() - started) / 1000);
                    console.log(`  ~${pct}% (${rate.toFixed(1)} files/s overall, ${(msg.updates / 1e6).toFixed(0)}M cell updates on worker 0)`);
                }
            } else if (msg.type === 'tiles') {
                global[msg.layer].addTiles(msg.ids, msg.buffers);
            } else if (msg.type === 'done') {
                resolve(msg.stats);
            }
        });
        worker.on('error', reject);
        worker.on('exit', code => { if (code !== 0) reject(new Error(`worker ${k} exited with code ${code}`)); });
    })));

    const stats = results.reduce((acc, s) => {
        for (const k of Object.keys(s)) acc[k] = (acc[k] || 0) + s[k];
        return acc;
    }, {});
    for (const layer of Object.keys(global)) {
        fs.writeFileSync(path.join(outDir, `${layer}.0.tiles`), global[layer].toBuffer());
    }
    stats.tiles = global.dnl.tiles.size;
    const elapsed = (Date.now() - started) / 1000;
    const manifest = {
        date: args.date,
        generatedAt: new Date().toISOString(),
        cutoffDb: args.cutoff,
        files: files.length,
        stride: args.stride,
        intervalSec,
        workers,
        elapsedSec: Math.round(elapsed),
        layers: ['dnl', 'traffic', 'above45'],
        timeAboveDb: TIME_ABOVE_DB,
        stats
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`Done in ${(elapsed / 60).toFixed(1)} min. Tiles: ${stats.tiles}, cell updates: ${(stats.updates / 1e9).toFixed(2)}B`);
    console.log(`Output: ${outDir}`);
    return { outDir, manifest };
}

// -------------------------------------------------------------- worker
function runWorker() {
    const { files, workerIndex, workers, outDir, cutoff, intervalSec } = workerData;
    const terrain = Terrain.fromTransferable(workerData.terrain);
    let dnl = new grid.TileStore();
    let traffic = new grid.TileStore();
    let above45 = new grid.TimeAboveStore();
    const tracker = new Tracker();
    let depositor = createDepositor({ store: dnl, cutoff, timeAbove: above45, timeAboveDb: TIME_ABOVE_DB, snapshotSec: intervalSec });
    let updates = 0, checks = 0;

    function flush() {
        for (const [layer, store] of [['dnl', dnl], ['traffic', traffic], ['above45', above45]]) {
            if ((store.tiles ? store.tiles.size : store.size) === 0) continue;
            const { ids, buffers } = store.transferable();
            parentPort.postMessage({ type: 'tiles', layer, ids, buffers }, buffers);
        }
        updates += depositor.stats.updates;
        checks += depositor.stats.checks;
        dnl = new grid.TileStore();
        traffic = new grid.TileStore();
        above45 = new grid.TimeAboveStore();
        depositor = createDepositor({ store: dnl, cutoff, timeAbove: above45, timeAboveDb: TIME_ABOVE_DB, snapshotSec: intervalSec });
    }
    const stats = {
        files: 0, records: 0, observations: 0, samples: 0, updates: 0,
        skippedNotSource: 0, skippedNoPosition: 0, skippedStale: 0, corruptFiles: 0
    };
    for (let i = 0; i < files.length; i++) {
        let data;
        try {
            data = JSON.parse(zlib.gunzipSync(fs.readFileSync(files[i])));
        } catch (err) {
            stats.corruptFiles++;
            continue;
        }
        stats.files++;
        const now = data.now;
        const planes = data.aircraft || [];
        for (let p = 0; p < planes.length; p++) {
            const plane = planes[p];
            stats.records++;
            if (typeof plane.lat !== 'number') { stats.skippedNoPosition++; continue; }
            const obs = normalize(plane, terrain);
            if (!obs) {
                if (plane.seen_pos > 10) stats.skippedStale++; else stats.skippedNotSource++;
                continue;
            }
            stats.observations++;
            const samples = tracker.update(obs, now);
            const weight = nightWeight(now, obs.lon);
            for (let k = 0; k < samples.length; k++) {
                const s = samples[k];
                // With a stride, each sample stands for more real time than the raw gap.
                if (intervalSec !== 5) { s.seconds *= intervalSec / 5; s.interval *= intervalSec / 5; }
                stats.samples++;
                traffic.add(grid.cellRow(s.lat), grid.cellCol(s.lon), s.seconds);
                depositor.deposit(s, weight, i);
            }
        }
        if (i % 100 === 99) tracker.prune(now - 120);
        if (i % FLUSH_FILES === FLUSH_FILES - 1) flush();
        if (i % 100 === 0 || i === files.length - 1) {
            parentPort.postMessage({ type: 'progress', done: i + 1, updates: updates + depositor.stats.updates });
        }
    }
    flush();
    stats.updates = updates;
    stats.checks = checks;
    parentPort.postMessage({ type: 'done', stats });
}

if (isMainThread) {
    if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
} else {
    runWorker();
}

module.exports = { main, listSnapshots };
