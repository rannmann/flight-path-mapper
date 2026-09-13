const { normalize, Tracker, DEFAULT_DT_S } = require('../lib/noise/observations');
const { referenceLevel } = require('../lib/noise/categories');

const flatTerrain = (elevationFt) => ({ elevationFt: () => elevationFt });

const jet = (extra = {}) => ({
  hex: 'abc123', type: 'adsb_icao', category: 'A3', lat: 47.6, lon: -122.3,
  alt_baro: 5000, alt_geom: 5200, gs: 250, baro_rate: 0, seen_pos: 0.5, ...extra
});

describe('normalize', () => {
  const terrain = flatTerrain(400);

  test('returns null for records without a position', () => {
    expect(normalize(jet({ lat: undefined }), terrain)).toBeNull();
    expect(normalize(jet({ lon: null }), terrain)).toBeNull();
  });

  test('returns null for stale positions', () => {
    expect(normalize(jet({ seen_pos: 10.5 }), terrain)).toBeNull();
    expect(normalize(jet({ seen_pos: 9.9 }), terrain)).not.toBeNull();
    expect(normalize(jet({ seen_pos: undefined }), terrain)).not.toBeNull();
  });

  test('returns null for non-aircraft', () => {
    expect(normalize(jet({ category: 'C2' }), terrain)).toBeNull();
    expect(normalize(jet({ type: 'adsb_icao_nt' }), terrain)).toBeNull();
  });

  test('computes height above ground from geometric altitude', () => {
    const o = normalize(jet(), terrain);
    expect(o.aglFt).toBe(5200 - 400);
    expect(o.category).toBe('A3');
    expect(o.phase).toBe('level');
    expect(o.refLevel).toBe(referenceLevel('A3', 'level'));
    expect(o.hex).toBe('abc123');
  });

  test('falls back to barometric altitude and never goes below ground', () => {
    expect(normalize(jet({ alt_geom: undefined }), terrain).aglFt).toBe(5000 - 400);
    expect(normalize(jet({ alt_geom: 100 }), terrain).aglFt).toBe(0);
  });

  test('treats "ground" as on the surface', () => {
    const idle = normalize(jet({ alt_baro: 'ground', alt_geom: undefined, gs: 0 }), terrain);
    expect(idle.aglFt).toBe(0);
    expect(idle.phase).toBe('idle');
    const taxi = normalize(jet({ alt_baro: 'ground', gs: 15 }), terrain);
    expect(taxi.phase).toBe('taxi');
    const roll = normalize(jet({ alt_baro: 'ground', gs: 110 }), terrain);
    expect(roll.phase).toBe('roll');
    expect(roll.refLevel).toBe(referenceLevel('A3', 'roll'));
  });

  test('unknown altitude assumes pattern height', () => {
    const o = normalize(jet({ alt_baro: undefined, alt_geom: undefined }), terrain);
    expect(o.aglFt).toBe(1000);
  });

  test('uses geom_rate over baro_rate for phase', () => {
    const o = normalize(jet({ alt_geom: 1400, geom_rate: 2000, baro_rate: 0 }), terrain);
    expect(o.phase).toBe('takeoff');
  });
});

describe('Tracker', () => {
  const obs = (over = {}) => ({ hex: 'abc123', lat: 47.6, lon: -122.3, aglFt: 1000, refLevel: 80, ...over });

  test('first sighting yields one default-length sample', () => {
    const tr = new Tracker();
    const out = tr.update(obs(), 1000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lat: 47.6, lon: -122.3, aglFt: 1000, refLevel: 80, seconds: DEFAULT_DT_S });
  });

  test('interpolates a 1.2 km move over 5 s into 3 samples totalling 5 s', () => {
    const tr = new Tracker();
    tr.update(obs(), 1000);
    const out = tr.update(obs({ lat: 47.6 + 0.0108, aglFt: 1300, refLevel: 85 }), 1005); // ~1.2 km north
    expect(out).toHaveLength(3);
    expect(out.reduce((s, o) => s + o.seconds, 0)).toBeCloseTo(5, 9);
    expect(out[2].lat).toBeCloseTo(47.6108, 9);
    expect(out[0].lat).toBeGreaterThan(47.6);
    expect(out[0].lat).toBeLessThan(out[1].lat);
    expect(out[0].aglFt).toBeCloseTo(1100, 9);
    expect(out[2].aglFt).toBe(1300);
    out.forEach(o => expect(o.refLevel).toBe(85));
  });

  test('does not interpolate across a 60 s gap', () => {
    const tr = new Tracker();
    tr.update(obs(), 1000);
    const out = tr.update(obs({ lat: 47.7 }), 1060);
    expect(out).toHaveLength(1);
    expect(out[0].seconds).toBe(DEFAULT_DT_S);
    expect(out[0].lat).toBe(47.7);
  });

  test('does not interpolate an implausible jump', () => {
    const tr = new Tracker();
    tr.update(obs(), 1000);
    const out = tr.update(obs({ lat: 48.6 }), 1005); // 111 km in 5 s
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBe(48.6);
  });

  test('tracks aircraft independently', () => {
    const tr = new Tracker();
    tr.update(obs(), 1000);
    expect(tr.update(obs({ hex: 'def456' }), 1005)).toHaveLength(1);
    expect(tr.update(obs({ lat: 47.6 + 0.0108 }), 1005)).toHaveLength(3);
  });

  test('prune forgets old aircraft', () => {
    const tr = new Tracker();
    tr.update(obs(), 1000);
    tr.update(obs({ hex: 'def456' }), 1100);
    tr.prune(1050);
    expect(tr.last.has('abc123')).toBe(false);
    expect(tr.last.has('def456')).toBe(true);
    expect(tr.update(obs({ lat: 47.6 + 0.0108 }), 1105)).toHaveLength(1); // starts over
  });
});
