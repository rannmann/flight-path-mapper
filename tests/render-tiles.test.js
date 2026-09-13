const fs = require('fs');
const os = require('os');
const path = require('path');
const { TileStore, cellRow, cellCol, rowLat, colLon } = require('../lib/noise/grid');
const { encodeDb, encodeTraffic, decodeDb, decodeTraffic, SECONDS_PER_DAY, CUTOFF_DB, DB_OFFSET, DB_STEP } = require('../lib/noise/dnl');
const { decodeGray } = require('../lib/noise/png');
const { render, latToY, lonToX } = require('../scripts/render-tiles');

// Weighted energy-seconds that decode to exactly `db` DNL.
const energyForDb = db => SECONDS_PER_DAY * Math.pow(10, db / 10);

// Seattle-ish loud cell, plus a quieter neighbour in the same row (for the
// energy-averaging check), and a Sydney-ish cell far away.
const A = { lat: 47.45, lon: -122.30, db: 65 };
const B = { lat: -33.95, lon: 151.18, db: 50 };
const TRAFFIC_SECONDS = 100;

function writeFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noise-'));
    const inDir = path.join(dir, 'noise', '2026-01-01');
    fs.mkdirSync(inDir, { recursive: true });

    const rowA = cellRow(A.lat), colA = cellCol(A.lon);
    const rowB = cellRow(B.lat), colB = cellCol(B.lon);

    const dnl = new TileStore();
    dnl.add(rowA, colA, energyForDb(A.db));
    dnl.add(rowA, colA + 1, energyForDb(A.db - 10));   // neighbour, 10 dB quieter
    dnl.add(rowB, colB, energyForDb(B.db));

    const traffic = new TileStore();
    traffic.add(rowA, colA, TRAFFIC_SECONDS);

    // Split the dnl layer across two "worker" files to exercise addBuffer merging.
    const dnlA = new TileStore();
    dnlA.tiles.set([...dnl.tiles.keys()][0], [...dnl.tiles.values()][0]);
    const dnlB = new TileStore();
    dnlB.tiles.set([...dnl.tiles.keys()][1], [...dnl.tiles.values()][1]);
    fs.writeFileSync(path.join(inDir, 'dnl.0.tiles'), dnlA.toBuffer());
    fs.writeFileSync(path.join(inDir, 'dnl.1.tiles'), dnlB.toBuffer());
    fs.writeFileSync(path.join(inDir, 'traffic.0.tiles'), traffic.toBuffer());
    fs.writeFileSync(path.join(inDir, 'manifest.json'), JSON.stringify({
        date: '2026-01-01', cutoffDb: CUTOFF_DB, files: 3, workers: 2,
        stats: { observations: 42 }, generatedAt: new Date().toISOString()
    }));
    return { dir, inDir, outDir: path.join(dir, 'tiles'), rowA, colA, rowB, colB };
}

/** Decode the metatile containing world pixel (px, py) and return the pixel value. */
function pixelAt(outDir, layer, zoom, px, py) {
    const M = Math.min(8, 1 << zoom);
    const metaPx = 256 * M;
    const mx = Math.floor(px / metaPx), my = Math.floor(py / metaPx);
    const file = path.join(outDir, layer, String(zoom), `${mx}_${my}.png`);
    expect(fs.existsSync(file)).toBe(true);
    const img = decodeGray(fs.readFileSync(file));
    expect(img.width).toBe(metaPx);
    expect(img.height).toBe(metaPx);
    return img.pixels[(py - my * metaPx) * metaPx + (px - mx * metaPx)];
}

function worldPixel(lat, lon, zoom) {
    const worldPx = 256 * (1 << zoom);
    return { px: Math.floor(lonToX(lon, worldPx)), py: Math.floor(latToY(lat, worldPx)) };
}

describe('render-tiles', () => {
    let fx;
    beforeAll(() => { fx = writeFixture(); });
    afterAll(() => { fs.rmSync(fx.dir, { recursive: true, force: true }); });

    test('renders encoded values at every zoom up to maxZoom 3 and writes meta.json', () => {
        const t0 = Date.now();
        const meta = render({ inDir: fx.inDir, outDir: fx.outDir, maxZoom: 3, log: false });
        const elapsed = Date.now() - t0;
        // eslint-disable-next-line no-console
        console.log(`render() maxZoom 3 took ${elapsed} ms`);

        // Both cells A and A+1 are in the same row; use cell centres.
        const latA = rowLat(fx.rowA), lonA = colLon(fx.colA), lonA2 = colLon(fx.colA + 1);
        const latB = rowLat(fx.rowB), lonB = colLon(fx.colB);

        // Energy-averaged value of A and its neighbour when they share a pixel.
        const meanEnergy = (energyForDb(A.db) + energyForDb(A.db - 10)) / 2;
        const meanDb = 10 * Math.log10(meanEnergy / SECONDS_PER_DAY);
        const expectedMerged = encodeDb(meanDb);
        // Sanity: averaging in dB would give a different byte.
        expect(expectedMerged).not.toBe(encodeDb(A.db - 5));

        for (let z = 0; z <= 3; z++) {
            const pA = worldPixel(latA, lonA, z);
            const pA2 = worldPixel(latA, lonA2, z);
            const pB = worldPixel(latB, lonB, z);
            // At these zooms a cell is far below one pixel, so A and its neighbour
            // land in the same pixel and the pixel must hold the energy mean.
            expect(pA2).toEqual(pA);
            expect(pixelAt(fx.outDir, 'dnl', z, pA.px, pA.py)).toBe(expectedMerged);
            expect(pixelAt(fx.outDir, 'dnl', z, pB.px, pB.py)).toBe(encodeDb(B.db));
            // traffic is diluted over the whole pixel, so at low zoom a lone cell reads lower, never higher
            const t = pixelAt(fx.outDir, 'traffic', z, pA.px, pA.py);
            expect(t).toBeGreaterThan(0);
            expect(t).toBeLessThanOrEqual(encodeTraffic(TRAFFIC_SECONDS));
            // A pixel with no cells stays 0.
            expect(pixelAt(fx.outDir, 'dnl', z, pA.px + 3, pA.py + 3)).toBe(0);
            // z <= 3 is a single world-sized metatile.
            expect(fs.readdirSync(path.join(fx.outDir, 'dnl', String(z)))).toEqual(['0_0.png']);
        }

        expect(meta.tileSize).toBe(256);
        expect(meta.metaTileSize).toBe(8);
        expect(meta.maxZoom).toBe(3);
        expect(meta.date).toBe('2026-01-01');
        expect(meta.dates).toEqual(['2026-01-01']);
        expect(meta.days).toBe(1);
        expect(meta.label).toBe('2026-01-01');
        expect(meta.stats).toEqual({ observations: 42 });
        expect(meta.layers.dnl).toMatchObject({
            encoding: 'db', offset: DB_OFFSET, step: DB_STEP, cutoffDb: CUTOFF_DB, metatiles: 4
        });
        expect(meta.layers.dnl.minValue).toBe(decodeDb(encodeDb(B.db)));
        expect(meta.layers.dnl.maxValue).toBe(decodeDb(expectedMerged));
        expect(meta.layers.traffic).toMatchObject({ encoding: 'log40', metatiles: 4 });
        expect(meta.layers.traffic.maxValue).toBeGreaterThan(0);
        expect(meta.layers.traffic.maxValue).toBeLessThanOrEqual(decodeTraffic(encodeTraffic(TRAFFIC_SECONDS)));
        expect(JSON.parse(fs.readFileSync(path.join(fx.outDir, 'meta.json'), 'utf8'))).toEqual(meta);
    });

    test('omits metatiles that would be entirely empty (maxZoom 4)', () => {
        render({ inDir: fx.inDir, outDir: fx.outDir, layers: ['dnl'], maxZoom: 4, log: false });
        // z4: 16 x 16 tiles packed 8 x 8 -> a 2 x 2 grid of metatiles.
        const z4 = path.join(fx.outDir, 'dnl', '4');
        expect(fs.readdirSync(z4).sort()).toEqual(['0_0.png', '1_1.png']); // NW (Seattle) and SE (Sydney)
        expect(fs.existsSync(path.join(z4, '1_0.png'))).toBe(false);
        expect(fs.existsSync(path.join(z4, '0_1.png'))).toBe(false);

        const pA = worldPixel(rowLat(fx.rowA), colLon(fx.colA), 4);
        expect(pixelAt(fx.outDir, 'dnl', 4, pA.px, pA.py)).toBeGreaterThan(0);

        // Only dnl was re-rendered: the traffic entry from the earlier run survives.
        const meta = JSON.parse(fs.readFileSync(path.join(fx.outDir, 'meta.json'), 'utf8'));
        expect(meta.maxZoom).toBe(4);
        expect(meta.layers.traffic.encoding).toBe('log40');
    });
});
