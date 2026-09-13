const { parseArgs, splitAtGaps, toFeature, mergePaths, addPosition, emptyPaths, snapshotTime } = require('../index');
const config = require('../config');

describe('flight path helpers', () => {
  test('parseArgs defaults and flags', () => {
    const d = parseArgs([]);
    expect(d.date).toBe(config.defaultDate);
    expect(d.limit).toBe(Infinity);
    expect(d.stride).toBe(config.processing.lightweightMode ? 2 : 1);
    expect(parseArgs(['--limit', '5', '--stride=3', '--date', '2024-01-02'])).toEqual({ date: '2024-01-02', limit: 5, stride: 3 });
    expect(() => parseArgs(['--limit', '0'])).toThrow();
    expect(() => parseArgs(['--bogus'])).toThrow();
  });

  test('snapshotTime prefers `now`, else derives from the file name', () => {
    expect(snapshotTime({ now: 1693526399.175 }, 'x.json.gz', '2023-09-01')).toBe(1693526399.175);
    expect(snapshotTime({}, '/a/b/120005Z.json.gz', '2023-09-01')).toBe(Date.parse('2023-09-01T12:00:05Z') / 1000);
    expect(snapshotTime({}, 'weird.json.gz', '2023-09-01')).toBeNaN();
  });

  test('splitAtGaps starts a new part after more than 60 s and drops single points', () => {
    const pts = [[0, 0, 0], [0, 0.1, 5], [0, 0.2, 10], [0, 0.3, 71], [0, 0.4, 76], [0, 0.5, 200]];
    expect(splitAtGaps(pts)).toEqual([[[0, 0], [0, 0.1], [0, 0.2]], [[0, 0.3], [0, 0.4]]]);
    expect(splitAtGaps([[0, 0, 0]])).toEqual([]);
    expect(splitAtGaps([[0, 0, 0], [0, 1, 60]])).toEqual([[[0, 0], [0, 1]]]); // exactly 60 s is not a gap
  });

  test('toFeature builds a MultiLineString with properties', () => {
    const f = toFeature({ hex: 'abc', flight: 'UAL1', type: 'B738', points: [[-122, 47, 0], [-122.1, 47.1, 5]] });
    expect(f).toEqual({
      type: 'Feature',
      properties: { hex: 'abc', flight: 'UAL1', type: 'B738' },
      geometry: { type: 'MultiLineString', coordinates: [[[-122, 47], [-122.1, 47.1]]] }
    });
    expect(toFeature({ hex: 'abc', flight: null, type: null, points: [[-122, 47, 0]] })).toBeNull();
  });

  test('addPosition rounds, trims, dedupes and respects radii', () => {
    const paths = emptyPaths();
    const seattle = config.cities.USA_WA_Seattle;
    const radius = config.defaultRadii[0];
    const plane = { hex: 'abc', flight: 'ASA1  ', t: 'B739', lat: seattle.lat + 0.1234567, lon: seattle.lon };
    addPosition(paths, plane, 100);
    addPosition(paths, plane, 105); // same spot: dropped
    addPosition(paths, { ...plane, lat: seattle.lat + 0.2 }, 110);
    const frag = paths.USA_WA_Seattle[radius].abc;
    expect(frag.flight).toBe('ASA1');
    expect(frag.type).toBe('B739');
    expect(frag.points).toEqual([[seattle.lon, Number((seattle.lat + 0.1234567).toFixed(5)), 100], [seattle.lon, Number((seattle.lat + 0.2).toFixed(5)), 110]]);
    expect(paths.GBR_London[radius].abc).toBeUndefined();

    addPosition(paths, { hex: 'far', lat: seattle.lat + 3, lon: seattle.lon }, 100); // ~207 miles
    expect(paths.USA_WA_Seattle[radius].far).toBeUndefined();
  });

  test('mergePaths appends in order and skips the duplicate boundary point', () => {
    const radius = config.defaultRadii[0];
    const a = emptyPaths(), b = emptyPaths();
    a.GBR_London[radius].x = { hex: 'x', flight: null, type: null, points: [[0, 51, 0], [0.1, 51, 5]] };
    b.GBR_London[radius].x = { hex: 'x', flight: 'BAW1', type: 'A320', points: [[0.1, 51, 10], [0.2, 51, 15]] };
    b.GBR_London[radius].y = { hex: 'y', flight: null, type: null, points: [[0.3, 51, 10]] };
    mergePaths(a, b);
    expect(a.GBR_London[radius].x.points).toEqual([[0, 51, 0], [0.1, 51, 5], [0.2, 51, 15]]);
    expect(a.GBR_London[radius].x.flight).toBe('BAW1');
    expect(a.GBR_London[radius].y.points).toEqual([[0.3, 51, 10]]);
  });
});
