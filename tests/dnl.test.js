const dnl = require('../lib/noise/dnl');

const T = (iso) => Date.parse(iso) / 1000;

describe('local solar time', () => {
  test('localSolarHour at known points', () => {
    expect(dnl.localSolarHour(T('2023-09-01T12:00:00Z'), 0)).toBeCloseTo(12, 6);
    expect(dnl.localSolarHour(T('2023-09-01T12:00:00Z'), -180)).toBeCloseTo(0, 6);
    expect(dnl.localSolarHour(T('2023-09-01T12:00:00Z'), 180)).toBeCloseTo(0, 6);
    expect(dnl.localSolarHour(T('2023-09-01T00:00:00Z'), -120)).toBeCloseTo(16, 6);
    expect(dnl.localSolarHour(T('2023-09-01T23:00:00Z'), 45)).toBeCloseTo(2, 6);
  });

  test('isNight', () => {
    expect(dnl.isNight(T('2023-09-01T12:00:00Z'), 0)).toBe(false);
    expect(dnl.isNight(T('2023-09-01T12:00:00Z'), -180)).toBe(true);
    expect(dnl.isNight(T('2023-09-01T22:00:00Z'), 0)).toBe(true);   // 22:00 inclusive
    expect(dnl.isNight(T('2023-09-01T21:59:00Z'), 0)).toBe(false);
    expect(dnl.isNight(T('2023-09-01T06:59:00Z'), 0)).toBe(true);
    expect(dnl.isNight(T('2023-09-01T07:00:00Z'), 0)).toBe(false);  // 07:00 exclusive
    expect(dnl.isNight(T('2023-09-01T05:00:00Z'), -122.3)).toBe(false); // 20:50 solar in Seattle
  });

  test('nightWeight', () => {
    expect(dnl.NIGHT_WEIGHT).toBe(10);
    expect(dnl.nightWeight(T('2023-09-01T12:00:00Z'), 0)).toBe(1);
    expect(dnl.nightWeight(T('2023-09-01T12:00:00Z'), -180)).toBe(10);
  });
});

describe('energy <-> dB', () => {
  test('energyToDb of a day at 65 dB is 65', () => {
    expect(dnl.energyToDb(86400 * Math.pow(10, 6.5))).toBeCloseTo(65, 9);
    expect(dnl.energyToDb(0)).toBe(-Infinity);
  });

  test('dbToEnergy inverse', () => {
    expect(dnl.energyToDb(dnl.dbToEnergy(50) * 86400)).toBeCloseTo(50, 9);
  });
});

describe('dB pixel encoding', () => {
  test('round trips within a step', () => {
    for (let db = dnl.CUTOFF_DB; db <= 90; db += 0.37) {
      const v = dnl.encodeDb(db);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(Math.abs(dnl.decodeDb(v) - db)).toBeLessThanOrEqual(dnl.DB_STEP / 2 + 1e-9);
    }
  });

  test('0 below the cutoff', () => {
    expect(dnl.encodeDb(34.9)).toBe(0);
    expect(dnl.encodeDb(-Infinity)).toBe(0);
    expect(dnl.encodeDb(NaN)).toBe(0);
    expect(dnl.decodeDb(0)).toBeNull();
    expect(dnl.encodeDb(dnl.CUTOFF_DB)).toBeGreaterThanOrEqual(1);
  });

  test('clamps at 255', () => {
    expect(dnl.encodeDb(200)).toBe(255);
    expect(dnl.encodeDb(dnl.DB_OFFSET + 255 * dnl.DB_STEP)).toBe(255);
  });
});

describe('traffic pixel encoding', () => {
  test('round trips and clamps', () => {
    expect(dnl.encodeTraffic(0)).toBe(0);
    expect(dnl.decodeTraffic(0)).toBeNull();
    for (const s of [1, 5, 30, 300, 3000, 20000]) {
      const v = dnl.encodeTraffic(s);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(255);
      // log encoding: relative error bounded by half a step (about 6 %)
      expect(Math.abs(dnl.decodeTraffic(v) - s) / s).toBeLessThan(0.07);
    }
    expect(dnl.encodeTraffic(1e12)).toBe(255);
  });
});
