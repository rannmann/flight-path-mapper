/**
 * Source noise levels by ADS-B emitter category and flight phase.
 *
 * Values are LAmax in dBA at 305 m (1000 ft) slant distance. They are
 * approximations distilled from published data: FAA AC 36-1H certification
 * levels (small propeller aircraft flyover at 1000 ft), AEDT / EUROCONTROL
 * ANP noise-power-distance curves read at 1000 ft, and EASA certification
 * sheets for large jets. They are the calibration knob of the model:
 * change them here and nowhere else.
 *
 * Phases: idle (parked, APU), taxi, roll (takeoff or landing roll on the
 * runway), takeoff (airborne initial climb, full thrust), climb, level,
 * descent (low thrust), approach (landing configuration, airframe noise).
 *
 * Idle is deliberately conservative: a parked aircraft keeps its
 * transponder on for hours, but its APU is often off, and a 24 h average
 * amplifies anything continuous.
 */
const PHASES = ['idle', 'taxi', 'roll', 'takeoff', 'climb', 'level', 'descent', 'approach'];

const LEVELS = {
    //           idle taxi roll  t/o  clmb  lvl  dsc  appr
    A1: table([  42,  58,  74,  76,  73,  68,  62,  65 ]), // light piston / small single
    A2: table([  48,  65,  84,  84,  80,  74,  68,  76 ]), // turboprop, regional & business jet
    A3: table([  50,  70,  90,  89,  85,  78,  72,  81 ]), // narrow-body jet
    A4: table([  50,  70,  91,  90,  86,  79,  73,  82 ]), // high-vortex large (757)
    A5: table([  52,  72,  95,  94,  90,  82,  75,  85 ]), // heavy / wide-body
    A6: table([  50,  75, 108, 105, 100,  92,  85,  95 ]), // high performance / fighter
    A7: table([  48,  78,  82,  84,  82,  80,  82,  84 ]), // rotorcraft (descent includes BVI)
    B4: table([  40,  55,  68,  70,  68,  64,  58,  60 ])  // ultralight
};

function table(values) {
    const t = {};
    PHASES.forEach((p, i) => { t[p] = values[i]; });
    return t;
}

/** Categories that make no meaningful noise or are not aircraft. */
const SILENT = new Set(['B1', 'B2', 'B3', 'B6', 'B7']);

/**
 * ICAO type designators of helicopters. A fair share of helicopters (air
 * ambulances and police among them) broadcast no emitter category, and the
 * speed-based fallback would file them as light piston aircraft, 12 dB too
 * quiet in level flight. The snapshot's `t` field rescues those.
 */
const ROTORCRAFT_TYPES = new Set([
    'R22', 'R44', 'R66', 'H269', 'S330', 'S333', 'ENST', 'EN28', 'EN48', 'EXEC', 'B47G', 'B47J', 'B47T',
    'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'H120', 'H125', 'H130', 'H135', 'H145', 'H155',
    'H160', 'H175', 'H215', 'H225', 'AS32', 'AS3B', 'AS50', 'AS55', 'AS65', 'ALO2', 'ALO3', 'GAZL', 'PUMA',
    'A109', 'A119', 'A129', 'A139', 'A149', 'A169', 'A189', 'AW09', 'EH10', 'LYNX', 'WLNX',
    'B06', 'B06T', 'B105', 'B212', 'B222', 'B230', 'B407', 'B412', 'B427', 'B429', 'B430', 'B505', 'B525', 'BK17',
    'H500', 'MD50', 'MD52', 'MD60', 'H60', 'S61', 'S64', 'S76', 'S92', 'UH1', 'UH1Y', 'CH47', 'CH53', 'NH90',
    'KA26', 'KA27', 'KA32', 'MI2', 'MI8', 'MI17', 'MI24', 'MI26', 'KMAX', 'K126', 'HU30', 'A600', 'TIGR', 'V22'
]);

function isRotorcraftType(type) {
    return typeof type === 'string' && ROTORCRAFT_TYPES.has(type.trim().toUpperCase());
}

/**
 * Decide whether a raw ADS-B record should be treated as a noise source.
 * Rejects surface vehicles, obstacles, non-transponder emitters and silent
 * categories.
 */
function isNoiseSource(plane) {
    const cat = plane.category;
    if (cat && (cat[0] === 'C' || cat[0] === 'D')) return false;
    if (cat && SILENT.has(cat)) return false;
    if (plane.type === 'adsb_icao_nt') return false; // non-transponder (ground vehicles etc.)
    return true;
}

/**
 * Category used for the level table. Records with no usable category are
 * recognised as rotorcraft by ICAO type where possible, otherwise
 * classified from speed and altitude.
 */
function effectiveCategory(plane, altFt) {
    const cat = plane.category;
    if (cat && LEVELS[cat]) return cat;
    if (isRotorcraftType(plane.t)) return 'A7';
    const gs = plane.gs || 0;
    if (altFt > 25000 || gs > 320) return 'A3';
    if (gs > 180) return 'A2';
    return 'A1';
}

function referenceLevel(category, phase) {
    const t = LEVELS[category] || LEVELS.A1;
    return t[phase] !== undefined ? t[phase] : t.level;
}

module.exports = { PHASES, LEVELS, SILENT, ROTORCRAFT_TYPES, isRotorcraftType, isNoiseSource, effectiveCategory, referenceLevel };
