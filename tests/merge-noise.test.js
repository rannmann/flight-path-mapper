const fs = require('fs');
const os = require('os');
const path = require('path');
const grid = require('../lib/noise/grid');
const { merge, parseArgs } = require('../scripts/merge-noise');

function writeDay(root, date, cellValues, files = 10) {
  const dir = path.join(root, date);
  fs.mkdirSync(dir, { recursive: true });
  for (const layer of ['dnl', 'traffic', 'above45']) {
    const store = new grid.TileStore();
    for (const [tileRow, tileCol, idx, v] of cellValues[layer] || []) store.get(tileRow, tileCol, true)[idx] = v;
    fs.writeFileSync(path.join(dir, `${layer}.0.tiles`), store.toBuffer());
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    date, files, cutoffDb: 35, intervalSec: 5, stride: 1, timeAboveDb: 45, layers: ['dnl', 'traffic', 'above45'],
    stats: { files, records: files * 100 }
  }));
}

describe('merge-noise', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-noise-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('averages every layer over the number of days, including days that lack a tile', () => {
    writeDay(root, '2025-10-01', { dnl: [[10, 20, 5, 4]], traffic: [[10, 20, 5, 100]], above45: [[10, 20, 5, 60]] });
    writeDay(root, '2025-11-01', { dnl: [[10, 20, 5, 8], [11, 21, 0, 3]], traffic: [[10, 20, 5, 200]], above45: [] });
    writeDay(root, '2025-12-01', { dnl: [], traffic: [], above45: [[10, 20, 5, 120]] });
    const m = merge({ inDir: root, outDir: path.join(root, 'merged'), log: false });

    const load = layer => grid.TileStore.fromBuffer(fs.readFileSync(path.join(root, 'merged', `${layer}.0.tiles`)));
    expect(load('dnl').get(10, 20)[5]).toBeCloseTo((4 + 8) / 3, 9);
    expect(load('dnl').get(11, 21)[0]).toBeCloseTo(3 / 3, 9);
    expect(load('traffic').get(10, 20)[5]).toBeCloseTo((100 + 200) / 3, 9);
    expect(load('above45').get(10, 20)[5]).toBeCloseTo((60 + 120) / 3, 9);

    expect(m.days).toBe(3);
    expect(m.dates).toEqual(['2025-10-01', '2025-11-01', '2025-12-01']);
    expect(m.label).toBe('3 days, 2025-10-01 to 2025-12-01');
    expect(m.files).toBe(30);
    expect(m.stats.records).toBe(3000);
    expect(m.date).toBeNull();
    const written = JSON.parse(fs.readFileSync(path.join(root, 'merged', 'manifest.json'), 'utf8'));
    expect(written.perDay.map(d => d.date)).toEqual(m.dates);
  });

  test('explicit dates select a subset and keep their order', () => {
    writeDay(root, '2025-10-01', { dnl: [[1, 1, 0, 10]] });
    writeDay(root, '2025-11-01', { dnl: [[1, 1, 0, 20]] });
    writeDay(root, '2025-12-01', { dnl: [[1, 1, 0, 90]] });
    const m = merge({ inDir: root, outDir: path.join(root, 'merged'), dates: ['2025-12-01', '2025-10-01'], log: false });
    expect(m.dates).toEqual(['2025-12-01', '2025-10-01']);
    const dnl = grid.TileStore.fromBuffer(fs.readFileSync(path.join(root, 'merged', 'dnl.0.tiles')));
    expect(dnl.get(1, 1)[0]).toBeCloseTo(50, 9);
  });

  test('a missing manifest is an error, and the merged directory is excluded from auto-discovery', () => {
    writeDay(root, '2025-10-01', { dnl: [[1, 1, 0, 10]] });
    fs.mkdirSync(path.join(root, '2025-11-01'));
    expect(() => merge({ inDir: root, outDir: path.join(root, 'merged'), log: false })).toThrow(/no manifest for 2025-11-01/);
    fs.rmSync(path.join(root, '2025-11-01'), { recursive: true });
    merge({ inDir: root, outDir: path.join(root, 'merged'), log: false });
    const again = merge({ inDir: root, outDir: path.join(root, 'merged'), log: false });
    expect(again.days).toBe(1);
  });

  test('parseArgs', () => {
    const a = parseArgs(['--dates', '2025-10-01, 2025-11-01', '--in', '/x/noise']);
    expect(a.dates).toEqual(['2025-10-01', '2025-11-01']);
    expect(a.out).toBe(path.join('/x/noise', 'merged'));
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
  });
});

describe('TileStore.scale', () => {
  test('multiplies every cell', () => {
    const s = new grid.TileStore();
    s.get(3, 4, true)[7] = 10;
    s.get(5, 6, true)[0] = 4;
    s.scale(0.5);
    expect(s.get(3, 4)[7]).toBe(5);
    expect(s.get(5, 6)[0]).toBe(2);
  });
});
