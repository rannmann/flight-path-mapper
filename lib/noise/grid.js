/**
 * Fixed global grid used by every stage of the pipeline.
 *
 * Plate carree, 120 cells per degree (30 arc-seconds). Row 0 is the
 * northernmost row (lat 90 .. 89.99), column 0 starts at lon -180.
 * Cells are grouped into 0.5 degree tiles of 60 x 60 cells so that only
 * touched tiles need memory.
 */
const CELLS_PER_DEG = 120;
const ROWS = 180 * CELLS_PER_DEG;        // 21600
const COLS = 360 * CELLS_PER_DEG;        // 43200
const TILE = 60;                          // cells per tile side (0.5 degree)
const TILE_CELLS = TILE * TILE;           // 3600
const TILE_ROWS = ROWS / TILE;            // 360
const TILE_COLS = COLS / TILE;            // 720
const KM_PER_DEG = 111.32;
const CELL_KM_NS = KM_PER_DEG / CELLS_PER_DEG; // 0.9277 km
const CELL_DEG = 1 / CELLS_PER_DEG;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Row index of a latitude. */
function cellRow(lat) {
    return clamp(Math.floor((90 - lat) * CELLS_PER_DEG), 0, ROWS - 1);
}

/** Column index of a longitude, wrapped into [0, COLS). */
function cellCol(lon) {
    const c = Math.floor((lon + 180) * CELLS_PER_DEG);
    return ((c % COLS) + COLS) % COLS;
}

/** Wrap any integer column into [0, COLS). */
function wrapCol(col) {
    return ((col % COLS) + COLS) % COLS;
}

/** Latitude of a row's centre. */
function rowLat(row) {
    return 90 - (row + 0.5) * CELL_DEG;
}

/** Longitude of a column's centre. */
function colLon(col) {
    return -180 + (col + 0.5) * CELL_DEG;
}

/** East-west size of a cell at a latitude, in km. */
function cellKmEW(lat) {
    return CELL_KM_NS * Math.cos(lat * Math.PI / 180);
}

function tileRowOf(row) { return Math.floor(row / TILE); }
function tileColOf(col) { return Math.floor(col / TILE); }
function tileId(tileRow, tileCol) { return tileRow * TILE_COLS + tileCol; }
function tileRowFromId(id) { return Math.floor(id / TILE_COLS); }
function tileColFromId(id) { return id % TILE_COLS; }

/** Index inside a tile's Float64Array for a global (row, col). */
function cellIndexInTile(row, col) {
    return (row % TILE) * TILE + (col % TILE);
}

/** Bounds of a tile in degrees. */
function tileBounds(tileRow, tileCol) {
    return {
        north: 90 - tileRow * TILE * CELL_DEG,
        south: 90 - (tileRow + 1) * TILE * CELL_DEG,
        west: -180 + tileCol * TILE * CELL_DEG,
        east: -180 + (tileCol + 1) * TILE * CELL_DEG
    };
}

/**
 * Sparse store of tiles. Each tile is a Float64Array(TILE_CELLS).
 * `owns(tileCol)` lets a worker restrict itself to a subset of columns.
 */
class TileStore {
    constructor(owns = null) {
        this.tiles = new Map();
        this.owns = owns;
    }

    get(tileRow, tileCol, create = true) {
        const id = tileId(tileRow, tileCol);
        let t = this.tiles.get(id);
        if (!t && create) {
            t = new Float64Array(TILE_CELLS);
            this.tiles.set(id, t);
        }
        return t;
    }

    add(row, col, value) {
        const tr = tileRowOf(row), tc = tileColOf(col);
        if (this.owns && !this.owns(tc)) return;
        this.get(tr, tc)[cellIndexInTile(row, col)] += value;
    }

    /** Serialise to a Buffer: uint32 count, then (uint32 id, 3600 float64) records. */
    toBuffer() {
        const ids = [...this.tiles.keys()].sort((a, b) => a - b);
        const recordBytes = 4 + TILE_CELLS * 8;
        const buf = Buffer.alloc(4 + ids.length * recordBytes);
        buf.writeUInt32LE(ids.length, 0);
        let off = 4;
        for (const id of ids) {
            buf.writeUInt32LE(id, off);
            off += 4;
            const t = this.tiles.get(id);
            Buffer.from(t.buffer, t.byteOffset, t.byteLength).copy(buf, off);
            off += TILE_CELLS * 8;
        }
        return buf;
    }

    /** Merge a serialised buffer into this store (summing). */
    addBuffer(buf) {
        const n = buf.readUInt32LE(0);
        let off = 4;
        for (let i = 0; i < n; i++) {
            const id = buf.readUInt32LE(off);
            off += 4;
            // Records are 3604 bytes apart, so the float data is not 8-byte
            // aligned inside `buf`; copy it into an aligned array instead of
            // viewing it in place.
            const src = new Float64Array(TILE_CELLS);
            Buffer.from(src.buffer).set(buf.subarray(off, off + TILE_CELLS * 8));
            off += TILE_CELLS * 8;
            const t = this.tiles.get(id);
            if (!t) {
                this.tiles.set(id, src);
            } else {
                for (let k = 0; k < TILE_CELLS; k++) t[k] += src[k];
            }
        }
    }

    /**
     * Hand the tiles over for a zero-copy postMessage: returns the ids and
     * the underlying ArrayBuffers (pass `buffers` as the transfer list).
     * This store is empty afterwards.
     */
    transferable() {
        const ids = new Uint32Array(this.tiles.size);
        const buffers = new Array(this.tiles.size);
        let i = 0;
        for (const [id, t] of this.tiles) { ids[i] = id; buffers[i] = t.buffer; i++; }
        this.tiles = new Map();
        return { ids, buffers };
    }

    /** Merge tiles received from `transferable()` (summing). */
    addTiles(ids, buffers) {
        for (let i = 0; i < ids.length; i++) {
            const src = new Float64Array(buffers[i]);
            const t = this.tiles.get(ids[i]);
            if (!t) { this.tiles.set(ids[i], src); continue; }
            for (let k = 0; k < TILE_CELLS; k++) t[k] += src[k];
        }
    }

    static fromBuffer(buf) {
        const s = new TileStore();
        s.addBuffer(buf);
        return s;
    }
}

/**
 * Seconds per cell during which at least one aircraft exceeds a level.
 * Values live in a normal TileStore; a side table remembers, per cell,
 * how many seconds of the *current* snapshot interval have already been
 * counted so that overlapping aircraft do not double count and a cell can
 * never exceed 24 h per day.
 */
class TimeAboveStore {
    constructor() {
        this.values = new TileStore();
        this.side = new Map(); // tileId -> { stamp: Int32Array, acc: Float32Array }
    }

    /** Arrays for a tile; created on first use. */
    tile(tileRow, tileCol) {
        const id = tileId(tileRow, tileCol);
        let side = this.side.get(id);
        if (!side) {
            side = { stamp: new Int32Array(TILE_CELLS).fill(-1), acc: new Float32Array(TILE_CELLS) };
            this.side.set(id, side);
        }
        return { values: this.values.get(tileRow, tileCol, true), stamp: side.stamp, acc: side.acc };
    }

    /**
     * Count `seconds` for cell index `idx` of a tile obtained from tile(),
     * within snapshot `snapshot` whose interval is `intervalSec` long.
     */
    static add(t, idx, seconds, snapshot, intervalSec) {
        if (t.stamp[idx] !== snapshot) { t.stamp[idx] = snapshot; t.acc[idx] = 0; }
        const room = intervalSec - t.acc[idx];
        if (room <= 0) return;
        const add = seconds < room ? seconds : room;
        t.acc[idx] += add;
        t.values[idx] += add;
    }

    /** Hand the value tiles over (zero-copy) and reset. */
    transferable() {
        this.side = new Map();
        return this.values.transferable();
    }

    get size() { return this.values.tiles.size; }
}

module.exports = {
    CELLS_PER_DEG, ROWS, COLS, TILE, TILE_CELLS, TILE_ROWS, TILE_COLS,
    KM_PER_DEG, CELL_KM_NS, CELL_DEG,
    cellRow, cellCol, wrapCol, rowLat, colLon, cellKmEW,
    tileRowOf, tileColOf, tileId, tileRowFromId, tileColFromId,
    cellIndexInTile, tileBounds, TileStore, TimeAboveStore
};
