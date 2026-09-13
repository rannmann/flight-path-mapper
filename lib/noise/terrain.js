/**
 * Ground elevation lookup: a 2 arc-minute DEM (ETOPO 2022) overridden by
 * the nearest airport elevation within AIRPORT_RADIUS_KM, because airports
 * are where height above ground matters most and the DEM is coarse.
 *
 * The DEM is held in a SharedArrayBuffer so worker threads can share it.
 */
const fs = require('fs');
const path = require('path');

const AIRPORT_RADIUS_KM = 15;
const BUCKET_DEG = 0.25;
const M_TO_FT = 3.28084;

class Terrain {
    /**
     * @param {SharedArrayBuffer|ArrayBuffer} demBuffer int16le rows x cols
     * @param {{rows:number, cols:number}} meta
     * @param {Array<[number, number, number]>} airports [lat, lon, elevFt]
     */
    constructor(demBuffer, meta, airports) {
        this.dem = new Int16Array(demBuffer);
        this.rows = meta.rows;
        this.cols = meta.cols;
        this.meta = meta;
        this.airports = airports;
        this.buckets = new Map();
        for (let i = 0; i < airports.length; i++) {
            const [lat, lon] = airports[i];
            const key = Terrain.bucketKey(lat, lon);
            let b = this.buckets.get(key);
            if (!b) { b = []; this.buckets.set(key, b); }
            b.push(i);
        }
    }

    static bucketKey(lat, lon) {
        return `${Math.floor(lat / BUCKET_DEG)}_${Math.floor(lon / BUCKET_DEG)}`;
    }

    /** Load from data/terrain (default) into a SharedArrayBuffer. */
    static load(dir = path.join(__dirname, '..', '..', 'data', 'terrain')) {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'elevation.json'), 'utf8'));
        const raw = fs.readFileSync(path.join(dir, 'elevation.bin'));
        const sab = new SharedArrayBuffer(raw.byteLength);
        new Uint8Array(sab).set(raw);
        const airports = JSON.parse(fs.readFileSync(path.join(dir, 'airports.json'), 'utf8'));
        return new Terrain(sab, meta, airports);
    }

    /** What a worker needs to rebuild the same Terrain without re-reading disk. */
    toTransferable() {
        return { demBuffer: this.dem.buffer, meta: this.meta, airports: this.airports };
    }

    static fromTransferable({ demBuffer, meta, airports }) {
        return new Terrain(demBuffer, meta, airports);
    }

    /** DEM elevation in metres (no airport override). */
    demElevationM(lat, lon) {
        let r = Math.floor((90 - lat) * this.rows / 180);
        let c = Math.floor((lon + 180) * this.cols / 360);
        if (r < 0) r = 0; else if (r >= this.rows) r = this.rows - 1;
        c = ((c % this.cols) + this.cols) % this.cols;
        return this.dem[r * this.cols + c];
    }

    /** Nearest airport elevation (ft) within AIRPORT_RADIUS_KM, or null. */
    airportElevationFt(lat, lon) {
        const cosLat = Math.cos(lat * Math.PI / 180);
        const maxKm2 = AIRPORT_RADIUS_KM * AIRPORT_RADIUS_KM;
        let best = null, bestD = Infinity;
        const bl = Math.floor(lat / BUCKET_DEG), bo = Math.floor(lon / BUCKET_DEG);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const b = this.buckets.get(`${bl + dy}_${bo + dx}`);
                if (!b) continue;
                for (const i of b) {
                    const a = this.airports[i];
                    const dLatKm = (a[0] - lat) * 111.32;
                    const dLonKm = (a[1] - lon) * 111.32 * cosLat;
                    const d2 = dLatKm * dLatKm + dLonKm * dLonKm;
                    if (d2 < bestD && d2 <= maxKm2) { bestD = d2; best = a[2]; }
                }
            }
        }
        return best;
    }

    /** Ground elevation in feet, never below sea level. */
    elevationFt(lat, lon) {
        const ap = this.airportElevationFt(lat, lon);
        if (ap !== null) return Math.max(0, ap);
        return Math.max(0, this.demElevationM(lat, lon) * M_TO_FT);
    }
}

module.exports = { Terrain, AIRPORT_RADIUS_KM };
