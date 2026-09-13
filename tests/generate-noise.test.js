const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { main } = require('../scripts/generate-noise');
const { load, valueAt } = require('../scripts/inspect-noise');
const { energyToDb } = require('../lib/noise/dnl');

function writeSnapshot(dir, name, now, aircraft) {
    fs.writeFileSync(path.join(dir, name), zlib.gzipSync(JSON.stringify({ now, aircraft })));
}

describe('generate-noise end to end', () => {
    let tmp;
    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noise-'));
        // flat synthetic terrain: 18 x 36 cells of 0 m, no airports
        const terrain = path.join(tmp, 'terrain');
        fs.mkdirSync(terrain);
        fs.writeFileSync(path.join(terrain, 'elevation.bin'), Buffer.alloc(18 * 36 * 2));
        fs.writeFileSync(path.join(terrain, 'elevation.json'), JSON.stringify({ rows: 18, cols: 36 }));
        fs.writeFileSync(path.join(terrain, 'airports.json'), '[]');
        const snaps = path.join(tmp, 'history', '2023-09-01');
        fs.mkdirSync(snaps, { recursive: true });
        const t0 = 1693526400; // 2023-09-01T00:00Z -> 17:00 solar at lon -122 (day)
        const parked = { hex: 'aaaaaa', category: 'A3', lat: 47.45, lon: -122.31, alt_baro: 'ground', gs: 0, seen_pos: 0.5 };
        const takeoff = { hex: 'bbbbbb', category: 'A3', lat: 47.47, lon: -122.31, alt_geom: 800, geom_rate: 2500, gs: 160, seen_pos: 0.5 };
        const vehicle = { hex: 'cccccc', category: 'C2', lat: 47.45, lon: -122.32, alt_baro: 'ground', gs: 10, seen_pos: 0.5 };
        writeSnapshot(snaps, '000000Z.json.gz', t0, [parked, takeoff, vehicle]);
        writeSnapshot(snaps, '000005Z.json.gz', t0 + 5, [parked, { ...takeoff, lat: 47.48, alt_geom: 1000 }, vehicle]);
    });
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    test('deposits time-weighted energy around aircraft and nothing elsewhere', async () => {
        const out = path.join(tmp, 'noise');
        const { outDir, manifest } = await main([
            '--date', '2023-09-01', '--in', path.join(tmp, 'history'), '--out', out,
            '--terrain', path.join(tmp, 'terrain'), '--workers', '2'
        ]);
        expect(manifest.stats.files).toBe(2);
        expect(manifest.stats.observations).toBe(4); // vehicle skipped in both files
        expect(fs.existsSync(path.join(outDir, 'dnl.0.tiles'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'traffic.0.tiles'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'above45.0.tiles'))).toBe(true);
        expect(manifest.layers).toContain('above45');

        const dnl = load(outDir, 'dnl');
        const traffic = load(outDir, 'traffic');
        const under = energyToDb(valueAt(dnl, 47.475, -122.31));
        const near = energyToDb(valueAt(dnl, 47.475, -122.25));  // ~4.5 km east
        const far = energyToDb(valueAt(dnl, 47.475, -121.5));    // ~60 km east
        const london = valueAt(dnl, 51.5, -0.1);
        expect(under).toBeGreaterThan(near);
        expect(near).toBeGreaterThan(far);
        expect(london).toBe(0);
        // 10 s of takeoff at 89 dBA spread over a day is well below 65 dB DNL
        expect(under).toBeLessThan(65);
        expect(under).toBeGreaterThan(30);
        // parked aircraft: 5 s for first sighting + 5 s interval = 10 s of presence
        expect(valueAt(traffic, 47.45, -122.31)).toBeCloseTo(10, 5);
        // time above 45 dB: the parked A3 at idle (50 dBA at 305 m) is above 45 in its own cell
        // for the whole 10 s, but not 3 km away; never more than the elapsed time
        const above = load(outDir, 'above45');
        expect(valueAt(above, 47.45, -122.31)).toBeCloseTo(10, 5);
        expect(valueAt(above, 47.45, -122.10)).toBe(0); // 16 km east: even the takeoff is under 45 dB
        expect(valueAt(above, 47.475, -122.31)).toBeLessThanOrEqual(10 + 1e-9);
        expect(valueAt(above, 47.475, -122.31)).toBeGreaterThan(0);
    }, 60000);
});
