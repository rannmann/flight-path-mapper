/**
 * Turns raw ADS-B Exchange records into noise-model observations and
 * interpolates between successive positions of the same aircraft.
 */
const { isNoiseSource, effectiveCategory, referenceLevel } = require('./categories');
const { detectPhase } = require('./phase');

const MAX_POSITION_AGE_S = 10;   // drop stale positions (readsb keeps them for ~60 s)
const MAX_GAP_S = 15;            // do not interpolate across longer gaps
const MAX_JUMP_KM = 6;           // or implausible jumps
const STEP_KM = 0.5;             // max spacing of interpolated samples
const DEFAULT_DT_S = 5;          // snapshot interval

/**
 * Normalise one raw record. Returns null when the record should be skipped.
 * @param {object} plane raw record from the snapshot's `aircraft` array
 * @param {Terrain} terrain
 */
function normalize(plane, terrain) {
    if (typeof plane.lat !== 'number' || typeof plane.lon !== 'number') return null;
    if (plane.seen_pos !== undefined && plane.seen_pos > MAX_POSITION_AGE_S) return null;
    if (!isNoiseSource(plane)) return null;

    const onGround = plane.alt_baro === 'ground';
    let altFt = onGround ? null : (typeof plane.alt_geom === 'number' ? plane.alt_geom
        : typeof plane.alt_baro === 'number' ? plane.alt_baro : null);
    const groundFt = terrain.elevationFt(plane.lat, plane.lon);
    let aglFt;
    if (onGround) {
        aglFt = 0;
        altFt = groundFt;
    } else if (altFt === null) {
        aglFt = 1000; // unknown altitude: assume pattern height
        altFt = groundFt + aglFt;
    } else {
        aglFt = Math.max(0, altFt - groundFt);
    }
    const gs = typeof plane.gs === 'number' ? plane.gs : 0;
    const verticalRate = typeof plane.geom_rate === 'number' ? plane.geom_rate
        : typeof plane.baro_rate === 'number' ? plane.baro_rate : 0;
    const category = effectiveCategory(plane, altFt);
    const phase = detectPhase({ aglFt, verticalRate, gs, onGround: onGround || aglFt < 50 });
    return {
        hex: plane.hex,
        lat: plane.lat,
        lon: plane.lon,
        aglFt,
        gs,
        category,
        phase,
        refLevel: referenceLevel(category, phase)
    };
}

/**
 * Remembers the last position of each aircraft and expands a new
 * observation into evenly spaced samples covering the interval since the
 * previous one. Each sample carries `seconds`, its share of that interval.
 */
class Tracker {
    constructor() {
        this.last = new Map();
    }

    /**
     * Each sample also carries `interval`, the full gap it was cut from.
     * @returns {Array<{lat:number, lon:number, aglFt:number, refLevel:number, seconds:number, interval:number}>}
     */
    update(obs, nowSec) {
        const prev = this.last.get(obs.hex);
        this.last.set(obs.hex, { lat: obs.lat, lon: obs.lon, aglFt: obs.aglFt, t: nowSec });
        if (!prev) {
            return [{ lat: obs.lat, lon: obs.lon, aglFt: obs.aglFt, refLevel: obs.refLevel, seconds: DEFAULT_DT_S, interval: DEFAULT_DT_S }];
        }
        const dt = nowSec - prev.t;
        if (dt <= 0 || dt > MAX_GAP_S) {
            return [{ lat: obs.lat, lon: obs.lon, aglFt: obs.aglFt, refLevel: obs.refLevel, seconds: DEFAULT_DT_S, interval: DEFAULT_DT_S }];
        }
        const cosLat = Math.cos(obs.lat * Math.PI / 180);
        const dKm = Math.hypot((obs.lat - prev.lat) * 111.32, (obs.lon - prev.lon) * 111.32 * cosLat);
        if (dKm > MAX_JUMP_KM) {
            return [{ lat: obs.lat, lon: obs.lon, aglFt: obs.aglFt, refLevel: obs.refLevel, seconds: dt, interval: dt }];
        }
        const n = Math.max(1, Math.ceil(dKm / STEP_KM));
        const out = new Array(n);
        for (let k = 1; k <= n; k++) {
            const f = k / n;
            out[k - 1] = {
                lat: prev.lat + (obs.lat - prev.lat) * f,
                lon: prev.lon + (obs.lon - prev.lon) * f,
                aglFt: prev.aglFt + (obs.aglFt - prev.aglFt) * f,
                refLevel: obs.refLevel,
                seconds: dt / n,
                interval: dt
            };
        }
        return out;
    }

    /** Forget aircraft not seen since `beforeSec` to bound memory. */
    prune(beforeSec) {
        for (const [hex, p] of this.last) if (p.t < beforeSec) this.last.delete(hex);
    }
}

module.exports = { normalize, Tracker, MAX_POSITION_AGE_S, MAX_GAP_S, STEP_KM, DEFAULT_DT_S };
