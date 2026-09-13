#!/usr/bin/env node
/**
 * Build the site from several days of ADS-B Exchange archives.
 *
 *   node scripts/run-days.js --dates 2025-10-01,2025-11-01,... [--keep] [--skip-render]
 *
 * For each date, in order:
 *   1. download the snapshots (skipped when data/noise/<date>/manifest.json
 *      already exists, i.e. the day was generated before)
 *   2. run scripts/generate-noise.js
 *   3. delete data/flight-history/<date> to free ~20 GB (unless --keep)
 * The next day's download runs while the current day is being generated,
 * so at most two days of snapshots are on disk at once. Afterwards the
 * days are averaged into data/noise/merged (scripts/merge-noise.js), the
 * tiles are rendered from that, and docs/ is rebuilt.
 *
 * Every step is a child process, so the console output is the same as
 * running the steps by hand. Progress also goes to logs/run-days.log.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'config'));

const MIN_FREE_GB = 30;      // refuse to start a download below this
const EXPECTED_FILES = 17280; // 5 s snapshots per day

function parseArgs(argv) {
    const args = { dates: [], keep: false, skipRender: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dates') args.dates = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
        else if (a === '--keep') args.keep = true;
        else if (a === '--skip-render') args.skipRender = true;
        else throw new Error(`Unknown argument ${a}`);
    }
    for (const d of args.dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`bad date ${d}`);
    if (args.dates.length === 0) throw new Error('--dates is required');
    return args;
}

const logFile = path.join(ROOT, 'logs', 'run-days.log');
function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, line + '\n'); } catch (e) { /* ignore */ }
}

function run(label, args) {
    log(`start ${label}: node ${args.join(' ')}`);
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', code => {
            const mins = ((Date.now() - t0) / 60000).toFixed(1);
            if (code === 0) { log(`done ${label} in ${mins} min`); resolve(); } else reject(new Error(`${label} exited with code ${code} after ${mins} min`));
        });
    });
}

function freeGb(dir) {
    try { const s = fs.statfsSync(dir); return (s.bavail * s.bsize) / 1e9; } catch (e) { return Infinity; }
}

const snapshotDir = date => path.join(ROOT, config.paths.flightHistory, date);
const noiseDir = date => path.join(ROOT, config.paths.noise, date);

function generated(date) {
    const m = path.join(noiseDir(date), 'manifest.json');
    if (!fs.existsSync(m)) return false;
    try { return JSON.parse(fs.readFileSync(m, 'utf8')).files > 0 && fs.existsSync(path.join(noiseDir(date), 'dnl.0.tiles')); } catch (e) { return false; }
}

function snapshotCount(date) {
    try { return fs.readdirSync(snapshotDir(date)).filter(f => f.endsWith('.json.gz')).length; } catch (e) { return 0; }
}

async function ensureSnapshots(date) {
    if (generated(date)) { log(`${date}: already generated, no download needed`); return; }
    const have = snapshotCount(date);
    if (have >= EXPECTED_FILES - 200) { log(`${date}: ${have} snapshots already on disk`); return; }
    const free = freeGb(path.join(ROOT, 'data'));
    if (free < MIN_FREE_GB) throw new Error(`only ${free.toFixed(1)} GB free, need ${MIN_FREE_GB} GB before downloading ${date}`);
    await run(`download ${date}`, ['download.js', '--date', date]);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dates = args.dates;
    log(`run-days: ${dates.length} day(s): ${dates.join(', ')}${args.keep ? ' (keeping snapshots)' : ''}`);

    let pending = ensureSnapshots(dates[0]);
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        await pending;
        pending = i + 1 < dates.length ? ensureSnapshots(dates[i + 1]) : Promise.resolve();
        // Let a failed prefetch surface at the next `await`, not as an unhandled rejection.
        pending.catch(() => {});

        if (generated(date)) {
            log(`${date}: grids exist, skipping generation`);
        } else {
            await run(`generate ${date}`, ['scripts/generate-noise.js', '--date', date]);
            if (!generated(date)) throw new Error(`${date}: generation finished but no grids were written`);
        }
        if (!args.keep && fs.existsSync(snapshotDir(date))) {
            fs.rmSync(snapshotDir(date), { recursive: true, force: true });
            log(`${date}: removed snapshots (${freeGb(path.join(ROOT, 'data')).toFixed(0)} GB free)`);
        }
    }

    await run('merge', ['scripts/merge-noise.js', '--dates', dates.join(',')]);
    if (!args.skipRender) {
        await run('render', ['scripts/render-tiles.js', '--in', path.join(config.paths.noise, 'merged')]);
        await run('build', ['scripts/build-site.js']);
    }
    log('run-days: all done');
}

module.exports = { parseArgs };

if (require.main === module) {
    main().catch(err => { log(`run-days failed: ${err.message}`); process.exit(1); });
}
