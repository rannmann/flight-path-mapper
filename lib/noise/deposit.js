/**
 * The inner loop: spread one sample's energy over every grid cell within
 * hearing distance. Kept separate from the worker plumbing so it can be
 * profiled and tested on its own.
 */
const grid = require('./grid');
const { makeReceiver, audibleRadiusM, lateralAttenuation } = require('./propagation');

const FT_TO_M = 0.3048;
const M_PER_DEG_LAT = 111320;
const { TILE, COLS, ROWS, CELL_DEG, TILE_COLS } = grid;
const CELL_M = M_PER_DEG_LAT * CELL_DEG;

/**
 * Horizontal reach (m) of a source, including lateral attenuation at the
 * grazing angle seen from the edge of the footprint. Two fixed-point
 * iterations plus a 5 % margin keep it a safe upper bound.
 */
function reachM(refLevel, aglM, cutoff) {
    let r = audibleRadiusM(refLevel, aglM, cutoff);
    for (let i = 0; i < 2 && r > 0; i++) {
        const beta = Math.atan2(aglM, r) * 180 / Math.PI;
        r = audibleRadiusM(refLevel - lateralAttenuation(r, beta), aglM, cutoff);
    }
    return r * 1.05;
}

/**
 * @param {object} opts
 * @param {grid.TileStore} opts.store   destination (its `owns` filter is respected)
 * @param {number} opts.cutoff          dB below which nothing is deposited
 * @param {(tileCol:number)=>boolean} [opts.owns]
 * @param {grid.TimeAboveStore} [opts.timeAbove]   optional seconds-above-threshold layer
 * @param {number} [opts.timeAboveDb]              its threshold (dB)
 * @param {number} [opts.snapshotSec]              spacing of snapshots; no cell is credited
 *                                                 more than this per snapshot, whatever the
 *                                                 sample's own gap, so the layer is real clock time
 */
function createDepositor({ store, cutoff, owns = () => true, timeAbove = null, timeAboveDb = 45, snapshotSec = 5 }) {
    const receiver = makeReceiver();
    const radiusCache = new Map();
    const stats = { updates: 0, checks: 0 };

    function radiusFor(refLevel, aglM) {
        const key = refLevel * 4096 + Math.round(aglM / 25);
        let r = radiusCache.get(key);
        if (r === undefined) {
            r = reachM(refLevel, aglM, cutoff);
            radiusCache.set(key, r);
        }
        return r;
    }

    /**
     * @param {{lat:number, lon:number, aglFt:number, refLevel:number, seconds:number, interval?:number}} s
     * @param {number} weight     DNL night weighting (1 or 10)
     * @param {number} [snapshot] index of the snapshot the sample belongs to (for the time-above layer)
     */
    function deposit(s, weight, snapshot = 0) {
        const aglM = s.aglFt * FT_TO_M;
        const radius = radiusFor(s.refLevel, aglM);
        if (radius <= 0) return;
        const energy = Math.pow(10, s.refLevel / 10) * s.seconds * weight; // energy-seconds at 305 m
        const fMin = Math.pow(10, (cutoff - s.refLevel) / 10);           // factor below which we are under cutoff
        const fAbove = timeAbove ? Math.pow(10, (timeAboveDb - s.refLevel) / 10) : Infinity;

        const cosLat = Math.cos(s.lat * Math.PI / 180);
        const ewM = CELL_M * Math.max(cosLat, 0.02);
        const rc = grid.cellRow(s.lat), cc = grid.cellCol(s.lon);
        const dRows = Math.ceil(radius / CELL_M), dCols = Math.min(Math.ceil(radius / ewM), COLS >> 1);
        const r0 = Math.max(0, rc - dRows), r1 = Math.min(ROWS - 1, rc + dRows);
        const c0 = cc - dCols, c1 = cc + dCols; // unwrapped; wrapped per tile column below
        const r2 = radius * radius;
        // Offsets of cell centres from the sample, in metres, along each axis.
        const dy0 = (grid.rowLat(r0) - s.lat) * M_PER_DEG_LAT;      // first row (positive = north)
        const dx0 = (grid.colLon(c0) - s.lon) * M_PER_DEG_LAT * cosLat; // first column (unwrapped)

        const tc0 = Math.floor(c0 / TILE), tc1 = Math.floor(c1 / TILE);
        const tr0 = Math.floor(r0 / TILE), tr1 = Math.floor(r1 / TILE);
        for (let tcRaw = tc0; tcRaw <= tc1; tcRaw++) {
            const tc = ((tcRaw % TILE_COLS) + TILE_COLS) % TILE_COLS;
            if (!owns(tc)) continue;
            const tileC0 = Math.max(c0, tcRaw * TILE), tileC1 = Math.min(c1, tcRaw * TILE + TILE - 1);
            for (let tr = tr0; tr <= tr1; tr++) {
                const tileR0 = Math.max(r0, tr * TILE), tileR1 = Math.min(r1, tr * TILE + TILE - 1);
                let tile = store.get(tr, tc, false);
                let above = null;
                for (let row = tileR0; row <= tileR1; row++) {
                    const dy = dy0 - (row - r0) * CELL_M;
                    const dy2 = dy * dy;
                    if (dy2 > r2) continue;
                    const rowBase = (row % TILE) * TILE;
                    const colBase = ((tileC0 % TILE) + TILE) % TILE;
                    for (let col = tileC0, ci = 0; col <= tileC1; col++, ci++) {
                        const dx = dx0 + (col - c0) * ewM;
                        const h2 = dx * dx + dy2;
                        stats.checks++;
                        if (h2 > r2) continue;
                        const f = receiver.energyFactor(Math.sqrt(h2), aglM);
                        if (f < fMin) continue;
                        if (!tile) tile = store.get(tr, tc, true);
                        tile[rowBase + colBase + ci] += energy * f;
                        stats.updates++;
                        if (f >= fAbove) {
                            if (!above) above = timeAbove.tile(tr, tc);
                            grid.TimeAboveStore.add(above, rowBase + colBase + ci, s.seconds, snapshot, snapshotSec);
                        }
                    }
                }
            }
        }
    }

    return { deposit, stats, radiusFor };
}

module.exports = { createDepositor, reachM, FT_TO_M, M_PER_DEG_LAT };
