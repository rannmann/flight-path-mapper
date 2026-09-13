/**
 * Outdoor sound propagation from an aircraft to a ground receiver.
 *
 * L = L_ref - 20 log10(d / REF_DISTANCE_M) - ATM_DB_PER_KM * d_km - A_lat
 *
 *  - Spherical spreading from the 305 m (1000 ft) reference distance at
 *    which the source levels in categories.js are defined. The receiver is
 *    a ~1 km cell, not a point: the energy-mean of 1/d^2 over a 500 m disk
 *    around a source equals the level at about 180 m, so slant distances
 *    are combined with RECEIVER_OFFSET_M. This also stops a parked aircraft
 *    that happens to sit on a cell centre from dominating the whole cell.
 *  - Atmospheric absorption: 1.0 dB/km, a broadband A-weighted average for
 *    15 C / 70 % RH (ISO 9613-1 gives 0.5 to 2 dB/km across the spectrum).
 *  - Lateral attenuation per SAE AIR 5662 (as used in AEDT / ECAC Doc 29):
 *      A_lat = G(l) * Lambda(beta) / 10.86
 *      G(l)  = 11.83 (1 - e^(-0.00274 l))  for l <= 914 m, else 10.86
 *      Lambda(beta) = 1.137 - 0.0229 beta + 9.72 e^(-0.142 beta) for
 *                     0 <= beta <= 50 deg, else 0
 *    so the attenuation tops out at Lambda(0) = 10.86 dB for a distant
 *    receiver at grazing incidence and fades to nothing overhead.
 *    where l is lateral (horizontal) distance in metres and beta the
 *    elevation angle of the aircraft seen from the receiver, in degrees.
 */
const REF_DISTANCE_M = 305;
const ATM_DB_PER_KM = 1.0;
const RECEIVER_OFFSET_M = 180; // area-averaging offset, see header
const MIN_DISTANCE_M = 10;

function effectiveDistance(slantM) {
    return Math.sqrt(slantM * slantM + RECEIVER_OFFSET_M * RECEIVER_OFFSET_M);
}

function spreadingAndAtmLoss(slantM) {
    const d = Math.max(effectiveDistance(slantM), MIN_DISTANCE_M);
    return 20 * Math.log10(d / REF_DISTANCE_M) + ATM_DB_PER_KM * (d / 1000);
}

function lateralAttenuation(lateralM, elevationDeg) {
    const g = lateralM <= 914 ? 11.83 * (1 - Math.exp(-0.00274 * lateralM)) : 10.86;
    const b = Math.max(0, elevationDeg);
    const lambda = b <= 50 ? 1.137 - 0.0229 * b + 9.72 * Math.exp(-0.142 * b) : 0;
    return g * Math.max(0, lambda) / 10.86;
}

/** Level received at a ground point, dB. */
function receivedLevel(refLevel, horizontalM, aglM) {
    const slant = Math.sqrt(horizontalM * horizontalM + aglM * aglM);
    const elev = Math.atan2(aglM, horizontalM) * 180 / Math.PI;
    return refLevel - spreadingAndAtmLoss(slant) - lateralAttenuation(horizontalM, elev);
}

/**
 * Largest horizontal distance (m) at which the received level can still
 * reach `cutoffDb`, ignoring lateral attenuation (so it is an upper bound).
 */
function audibleRadiusM(refLevel, aglM, cutoffDb) {
    const budget = refLevel - cutoffDb;
    if (budget <= 0) return 0;
    // Solve 20 log10(d/305) + d/1000 = budget for slant d by bisection.
    let lo = MIN_DISTANCE_M, hi = 200000;
    if (spreadingAndAtmLoss(0) >= budget) return 0;
    if (spreadingAndAtmLoss(hi) < budget) return Math.sqrt(Math.max(0, hi * hi - aglM * aglM));
    lo = 0;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (spreadingAndAtmLoss(mid) < budget) lo = mid; else hi = mid;
    }
    const slant = lo;
    if (slant <= aglM) return 0;
    return Math.sqrt(slant * slant - aglM * aglM);
}

/**
 * Fast evaluator for the inner loop. energyFactor(h, agl) returns the
 * linear factor 10^(-(loss)/10) to multiply the source energy by, using
 * lookup tables instead of log/exp/pow per cell.
 */
function makeReceiver({ maxDistanceM = 120000, distStepM = 10 } = {}) {
    const n = Math.ceil(maxDistanceM / distStepM) + 1;
    const spread = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        spread[i] = Math.pow(10, -spreadingAndAtmLoss(i * distStepM) / 10);
    }
    // lateral table: G by 10 m steps up to 914 m (index 0..91, 91 = beyond), Lambda by 0.1 deg (0..500)
    const LSTEPS = 92, BSTEPS = 501;
    const lateral = new Float64Array(LSTEPS * BSTEPS);
    for (let li = 0; li < LSTEPS; li++) {
        const l = li === LSTEPS - 1 ? 1000 : li * 10;
        for (let bi = 0; bi < BSTEPS; bi++) {
            lateral[li * BSTEPS + bi] = Math.pow(10, -lateralAttenuation(l, bi / 10) / 10);
        }
    }
    const invStep = 1 / distStepM;
    const RAD2DEG10 = 1800 / Math.PI;

    return {
        energyFactor(horizontalM, aglM) {
            const slant = Math.sqrt(horizontalM * horizontalM + aglM * aglM);
            let di = Math.round(slant * invStep);
            if (di >= n) return 0;
            const elev10 = Math.atan2(aglM, horizontalM) * RAD2DEG10; // tenths of a degree
            const bi = elev10 >= 500 ? 500 : (elev10 | 0);
            const li = horizontalM >= 914 ? LSTEPS - 1 : (horizontalM * 0.1) | 0;
            return spread[di] * lateral[li * BSTEPS + bi];
        }
    };
}

module.exports = {
    REF_DISTANCE_M, ATM_DB_PER_KM, MIN_DISTANCE_M, RECEIVER_OFFSET_M,
    effectiveDistance, spreadingAndAtmLoss, lateralAttenuation, receivedLevel, audibleRadiusM, makeReceiver
};
