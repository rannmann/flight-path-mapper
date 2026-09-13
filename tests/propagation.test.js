const {
  REF_DISTANCE_M, receivedLevel, lateralAttenuation, audibleRadiusM, makeReceiver, spreadingAndAtmLoss
} = require('../lib/noise/propagation');

describe('receivedLevel', () => {
  test('1000 ft directly overhead is the reference level (within the 0.3 dB atmospheric term)', () => {
    expect(REF_DISTANCE_M).toBe(305);
    // 180 m receiver offset makes the 1000 ft overhead level ~1.7 dB below the reference
    expect(Math.abs(receivedLevel(80, 0, 305) - 80)).toBeLessThan(2.0);
    expect(receivedLevel(80, 0, 305)).toBeLessThan(80); // absorption only takes away
  });

  test('decreases monotonically with horizontal distance', () => {
    for (const agl of [0, 30, 305, 3000]) {
      let prev = Infinity;
      for (let h = 0; h <= 50000; h += 250) {
        const l = receivedLevel(90, h, agl);
        expect(l).toBeLessThanOrEqual(prev + 1e-9);
        prev = l;
      }
    }
  });

  test('decreases monotonically with height', () => {
    let prev = Infinity;
    for (let agl = 10; agl <= 20000; agl += 100) {
      const l = receivedLevel(90, 0, agl);
      expect(l).toBeLessThanOrEqual(prev + 1e-9);
      prev = l;
    }
  });

  test('spherical spreading: 6 dB per doubling of distance plus absorption', () => {
    // far enough out that the 180 m receiver offset is negligible
    const d1 = spreadingAndAtmLoss(10000), d2 = spreadingAndAtmLoss(20000);
    expect(d2 - d1).toBeCloseTo(20 * Math.log10(2) + 10.0, 2);
  });
});

describe('lateralAttenuation', () => {
  test('is zero above 50 degrees elevation', () => {
    for (const l of [0, 100, 914, 5000]) {
      expect(lateralAttenuation(l, 50.001)).toBe(0);
      expect(lateralAttenuation(l, 90)).toBe(0);
    }
  });

  test('stays within 0 .. 10.86 dB', () => {
    for (let l = 0; l <= 5000; l += 7) {
      for (let b = 0; b <= 90; b += 0.5) {
        const a = lateralAttenuation(l, b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(10.87); // formula peaks at 10.860 for l = 914 m, beta = 0
      }
    }
  });

  test('is about 10.86 dB for a distant receiver at grazing incidence', () => {
    expect(lateralAttenuation(2000, 0)).toBeCloseTo(10.86, 1);
    expect(lateralAttenuation(0, 0)).toBe(0);
  });
});

describe('audibleRadiusM', () => {
  test('is zero when the source cannot reach the cutoff', () => {
    expect(audibleRadiusM(35, 0, 35)).toBe(0);
    expect(audibleRadiusM(30, 0, 35)).toBe(0);
    expect(audibleRadiusM(60, 5000, 35)).toBe(0); // 5 km straight up already too quiet
  });

  test('grows with reference level', () => {
    let prev = 0;
    for (let ref = 40; ref <= 110; ref += 5) {
      const r = audibleRadiusM(ref, 100, 35);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  test('is an upper bound: the level at the radius is at the cutoff', () => {
    const r = audibleRadiusM(85, 300, 35);
    const slant = Math.sqrt(r * r + 300 * 300);
    expect(85 - spreadingAndAtmLoss(slant)).toBeCloseTo(35, 3);
  });
});

describe('makeReceiver', () => {
  test('energyFactor matches the exact formula within 3 %', () => {
    const rx = makeReceiver();
    for (const [h, agl] of [[1000, 300], [5000, 1000], [20000, 3000], [2000, 2000], [500, 100], [300, 50], [100, 1000], [3000, 100], [10000, 50]]) {
      const exact = Math.pow(10, receivedLevel(0, h, agl) / 10);
      const fast = rx.energyFactor(h, agl);
      expect(Math.abs(fast - exact) / exact).toBeLessThan(0.03);
    }
  });

  test('returns 0 beyond the table range', () => {
    expect(makeReceiver({ maxDistanceM: 1000 }).energyFactor(2000, 0)).toBe(0);
  });
});
