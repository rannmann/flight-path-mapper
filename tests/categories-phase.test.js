const { PHASES, LEVELS, isNoiseSource, effectiveCategory, referenceLevel } = require('../lib/noise/categories');
const { detectPhase } = require('../lib/noise/phase');

describe('isNoiseSource', () => {
  test('rejects surface vehicles and obstacles (C*, D*)', () => {
    for (const cat of ['C0', 'C1', 'C2', 'C3', 'D0', 'D7']) {
      expect(isNoiseSource({ category: cat })).toBe(false);
    }
  });

  test('rejects silent categories', () => {
    for (const cat of ['B1', 'B2', 'B3', 'B6', 'B7']) {
      expect(isNoiseSource({ category: cat })).toBe(false);
    }
  });

  test('rejects non-transponder emitters', () => {
    expect(isNoiseSource({ type: 'adsb_icao_nt', category: 'A1' })).toBe(false);
    expect(isNoiseSource({ type: 'adsb_icao_nt' })).toBe(false);
  });

  test('accepts aircraft with or without a category', () => {
    for (const cat of ['A0', 'A1', 'A3', 'A5', 'A7', 'B4']) {
      expect(isNoiseSource({ category: cat, type: 'adsb_icao' })).toBe(true);
    }
    expect(isNoiseSource({ type: 'adsc' })).toBe(true);
    expect(isNoiseSource({})).toBe(true);
  });
});

describe('effectiveCategory', () => {
  test('keeps a known category', () => {
    expect(effectiveCategory({ category: 'A5', gs: 10 }, 0)).toBe('A5');
    expect(effectiveCategory({ category: 'B4' }, 40000)).toBe('B4');
  });

  test('falls back by speed and altitude', () => {
    expect(effectiveCategory({}, 30000)).toBe('A3');
    expect(effectiveCategory({ gs: 400 }, 5000)).toBe('A3');
    expect(effectiveCategory({ gs: 250 }, 5000)).toBe('A2');
    expect(effectiveCategory({ gs: 100 }, 2000)).toBe('A1');
    expect(effectiveCategory({ category: 'A0', gs: 100 }, 2000)).toBe('A1'); // A0 has no table
  });
});

describe('referenceLevel', () => {
  test('every category has a value for every phase', () => {
    for (const cat of Object.keys(LEVELS)) {
      for (const phase of PHASES) {
        const l = referenceLevel(cat, phase);
        expect(typeof l).toBe('number');
        expect(l).toBeGreaterThan(30);
        expect(l).toBeLessThan(120);
      }
    }
  });

  test('takeoff > level > idle for every category', () => {
    for (const cat of Object.keys(LEVELS)) {
      expect(referenceLevel(cat, 'takeoff')).toBeGreaterThan(referenceLevel(cat, 'level'));
      expect(referenceLevel(cat, 'level')).toBeGreaterThan(referenceLevel(cat, 'idle'));
    }
  });

  test('unknown category or phase falls back sensibly', () => {
    expect(referenceLevel('ZZ', 'level')).toBe(LEVELS.A1.level);
    expect(referenceLevel('A3', 'hover')).toBe(LEVELS.A3.level);
  });
});

describe('detectPhase', () => {
  test('ground phases by speed', () => {
    expect(detectPhase({ aglFt: 0, gs: 0, onGround: true })).toBe('idle');
    expect(detectPhase({ aglFt: 0, gs: 3, onGround: true })).toBe('idle');
    expect(detectPhase({ aglFt: 0, gs: 20, onGround: true })).toBe('taxi');
    expect(detectPhase({ aglFt: 0, gs: 120, onGround: true })).toBe('roll');
    expect(detectPhase({ aglFt: 20, gs: 120 })).toBe('roll'); // low AGL counts as ground
  });

  test('airborne phases', () => {
    expect(detectPhase({ aglFt: 1500, verticalRate: 2500, gs: 160 })).toBe('takeoff');
    expect(detectPhase({ aglFt: 2000, verticalRate: -800, gs: 140 })).toBe('approach');
    expect(detectPhase({ aglFt: 8000, verticalRate: 1500, gs: 250 })).toBe('climb');
    expect(detectPhase({ aglFt: 12000, verticalRate: -1500, gs: 280 })).toBe('descent');
    expect(detectPhase({ aglFt: 35000, verticalRate: 0, gs: 450 })).toBe('level');
    expect(detectPhase({ aglFt: 35000, gs: 450 })).toBe('level'); // missing vertical rate
    expect(detectPhase({ aglFt: 4000, verticalRate: 100, gs: 200 })).toBe('level');
  });
});

describe('effectiveCategory with ICAO type', () => {
  const { effectiveCategory, isRotorcraftType } = require('../lib/noise/categories');
  test('a helicopter type with no category is treated as rotorcraft', () => {
    expect(effectiveCategory({ t: 'A139', gs: 120 }, 1500)).toBe('A7');
    expect(effectiveCategory({ t: 'R44', gs: 90 }, 800)).toBe('A7');
    expect(effectiveCategory({ category: 'A0', t: 'EC35', gs: 110 }, 1200)).toBe('A7');
  });
  test('a broadcast category wins over the type', () => {
    expect(effectiveCategory({ category: 'A1', t: 'A139', gs: 120 }, 1500)).toBe('A1');
  });
  test('non-helicopter types still fall back to speed classes', () => {
    expect(effectiveCategory({ t: 'C172', gs: 100 }, 2000)).toBe('A1');
    expect(effectiveCategory({ t: 'B738', gs: 250 }, 3000)).toBe('A2');
    expect(effectiveCategory({ gs: 450 }, 35000)).toBe('A3');
  });
  test('isRotorcraftType is tolerant of case and padding', () => {
    expect(isRotorcraftType(' r44 ')).toBe(true);
    expect(isRotorcraftType('')).toBe(false);
    expect(isRotorcraftType(undefined)).toBe(false);
  });
});
