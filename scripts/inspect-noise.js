#!/usr/bin/env node
/**
 * Print DNL values at points of interest and the loudest cells, for
 * sanity-checking a generated grid.
 *
 *   node scripts/inspect-noise.js [--in data/noise/<date>] [--top 10] [lat,lon[,label] ...]
 */
const fs = require('fs');
const path = require('path');
const grid = require('../lib/noise/grid');
const { energyToDb } = require('../lib/noise/dnl');

const POINTS = [
    [47.449, -122.309, 'SeaTac runway'],
    [47.53, -122.30, 'Burien (2 km N of SEA)'],
    [47.6062, -122.3321, 'Seattle downtown'],
    [48.455, -121.28, 'Cascades (old max)'],
    [51.4700, -0.4543, 'Heathrow'],
    [51.5074, -0.1278, 'London centre'],
    [39.8561, -104.6737, 'Denver DEN'],
    [39.7392, -104.9903, 'Denver downtown'],
    [35.5494, 139.7798, 'Tokyo Haneda'],
    [40.6413, -73.7781, 'JFK'],
    [45.0, -30.0, 'North Atlantic track area'],
];

function load(dir, layer) {
    const store = new grid.TileStore();
    for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(layer + '.') && f.endsWith('.tiles')) store.addBuffer(fs.readFileSync(path.join(dir, f)));
    }
    return store;
}

function valueAt(store, lat, lon) {
    const row = grid.cellRow(lat), col = grid.cellCol(lon);
    const t = store.get(grid.tileRowOf(row), grid.tileColOf(col), false);
    return t ? t[grid.cellIndexInTile(row, col)] : 0;
}

function main() {
    const argv = process.argv.slice(2);
    let inDir = null, top = 10;
    const extra = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--in') inDir = argv[++i];
        else if (argv[i] === '--top') top = parseInt(argv[++i], 10);
        else { const [lat, lon, label] = argv[i].split(','); extra.push([+lat, +lon, label || argv[i]]); }
    }
    if (!inDir) {
        const base = path.join(__dirname, '..', 'data', 'noise');
        const dates = fs.readdirSync(base).sort();
        inDir = path.join(base, dates[dates.length - 1]);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(inDir, 'manifest.json'), 'utf8'));
    console.log(`Grid: ${inDir} (${manifest.files} files, stride ${manifest.stride})`);
    const dnl = load(inDir, 'dnl');
    const traffic = load(inDir, 'traffic');
    const above = load(inDir, 'above45');
    console.log(`Tiles: ${dnl.tiles.size}`);
    console.log('\nPoints of interest:');
    for (const [lat, lon, label] of [...POINTS, ...extra]) {
        const db = energyToDb(valueAt(dnl, lat, lon));
        const sec = valueAt(traffic, lat, lon);
        const abv = valueAt(above, lat, lon);
        console.log(`  ${label.padEnd(28)} DNL ${db === -Infinity ? '  --  ' : db.toFixed(1).padStart(6)} dB   traffic ${(sec / 60).toFixed(1).padStart(7)} min/day   above 45 dB ${(abv / 60).toFixed(1).padStart(7)} min/day`);
    }
    const cells = [];
    let nonzero = 0;
    const hist = new Map();
    for (const [id, t] of dnl.tiles) {
        const tr = grid.tileRowFromId(id), tc = grid.tileColFromId(id);
        for (let k = 0; k < grid.TILE_CELLS; k++) {
            if (t[k] <= 0) continue;
            nonzero++;
            const db = energyToDb(t[k]);
            const band = Math.floor(db / 5) * 5;
            hist.set(band, (hist.get(band) || 0) + 1);
            if (db >= 70) cells.push([db, grid.rowLat(tr * grid.TILE + Math.floor(k / grid.TILE)), grid.colLon(tc * grid.TILE + (k % grid.TILE))]);
        }
    }
    cells.sort((a, b) => b[0] - a[0]);
    console.log(`\nNon-zero cells: ${nonzero}`);
    console.log('DNL histogram (5 dB bands, cells):');
    for (const b of [...hist.keys()].sort((a, b) => a - b)) console.log(`  ${String(b).padStart(3)}-${b + 5}: ${hist.get(b)}`);
    console.log(`\nTop ${top} cells:`);
    for (const [db, lat, lon] of cells.slice(0, top)) console.log(`  ${db.toFixed(1)} dB  ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
}

if (require.main === module) main();
module.exports = { load, valueAt };
