const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, cityDisplayName } = require('../scripts/build-site');

function tree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

describe('build-site', () => {
  let root, dirs;
  const config = { defaultDate: '2023-09-01', cities: { USA_WA_Seattle: { lat: 47.6, lon: -122.3 } } };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-site-'));
    dirs = {
      docsDir: path.join(root, 'docs'), siteDir: path.join(root, 'site'),
      tilesDir: path.join(root, 'tiles'), flightpathsDir: path.join(root, 'flightpaths')
    };
    tree(root, {
      'site/index.html': '<html>',
      'tiles/meta.json': JSON.stringify({ date: '2023-09-01', maxZoom: 3 }),
      'tiles/dnl/0/0_0.png': 'png',
      // already published (curated) flight paths
      'docs/data/flightpaths/GBR_London_20_miles.json': '{"old":1}',
      'docs/data/flightpaths/metadata.json': '{"files":[{"filename":"GBR_London_20_miles.json"}]}',
      'docs/stale.html': 'old page',
      // freshly generated ones
      'flightpaths/USA_WA_Seattle_80_miles.json': '{"new":1}',
      'flightpaths/metadata.json': '{"files":[{"file":"USA_WA_Seattle_80_miles.json"}]}'
    });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const list = () => fs.readdirSync(path.join(dirs.docsDir, 'data', 'flightpaths')).sort();

  test('default keeps the published flight paths and rebuilds everything else', () => {
    const r = build({ ...dirs, config, log: () => {} });
    expect(list()).toEqual(['GBR_London_20_miles.json', 'metadata.json']);
    expect(fs.readFileSync(path.join(dirs.docsDir, 'data/flightpaths/GBR_London_20_miles.json'), 'utf8')).toBe('{"old":1}');
    expect(fs.existsSync(path.join(dirs.docsDir, 'stale.html'))).toBe(false);
    expect(fs.existsSync(path.join(dirs.docsDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(dirs.docsDir, 'data/tiles/dnl/0/0_0.png'))).toBe(true);
    expect(fs.existsSync(path.join(dirs.docsDir, '.nojekyll'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.flightpaths-keep'))).toBe(false);
    expect(r.flightpathCount).toBe(1);
    const cfg = JSON.parse(fs.readFileSync(path.join(dirs.docsDir, 'data/config.json'), 'utf8'));
    expect(cfg.date).toBe('2023-09-01');
    expect(cfg.cities).toEqual([{ key: 'USA_WA_Seattle', name: 'Seattle, WA, USA', lat: 47.6, lon: -122.3 }]);
  });

  test('keep with nothing published yields no flight paths directory', () => {
    fs.rmSync(path.join(dirs.docsDir, 'data', 'flightpaths'), { recursive: true });
    const r = build({ ...dirs, config, log: () => {} });
    expect(fs.existsSync(path.join(dirs.docsDir, 'data', 'flightpaths'))).toBe(false);
    expect(r.flightpathCount).toBe(0);
  });

  test('refresh replaces the published set with data/flightpaths/', () => {
    const r = build({ ...dirs, config, flightpaths: 'refresh', log: () => {} });
    expect(list()).toEqual(['USA_WA_Seattle_80_miles.json', 'metadata.json']);
    expect(r.flightpathCount).toBe(2); // includes metadata.json
  });

  test('none ships no flight paths', () => {
    build({ ...dirs, config, flightpaths: 'none', log: () => {} });
    expect(fs.existsSync(path.join(dirs.docsDir, 'data', 'flightpaths'))).toBe(false);
  });

  test('rejects an unknown mode', () => {
    expect(() => build({ ...dirs, config, flightpaths: 'maybe', log: () => {} })).toThrow(/keep, refresh or none/);
  });

  test('cityDisplayName', () => {
    expect(cityDisplayName('USA_CA_LosAngeles')).toBe('Los Angeles, CA, USA');
    expect(cityDisplayName('GBR_London')).toBe('London, GBR');
  });
});
