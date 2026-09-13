const grid = require('../lib/noise/grid');

const {
  CELLS_PER_DEG, ROWS, COLS, TILE, TILE_CELLS, TILE_ROWS, TILE_COLS, CELL_DEG,
  cellRow, cellCol, wrapCol, rowLat, colLon, cellKmEW,
  tileRowOf, tileColOf, tileId, tileRowFromId, tileColFromId, cellIndexInTile, tileBounds, TileStore
} = grid;

describe('grid constants', () => {
  test('dimensions are consistent', () => {
    expect(ROWS).toBe(180 * CELLS_PER_DEG);
    expect(COLS).toBe(360 * CELLS_PER_DEG);
    expect(TILE_ROWS * TILE).toBe(ROWS);
    expect(TILE_COLS * TILE).toBe(COLS);
    expect(TILE_CELLS).toBe(TILE * TILE);
  });
});

describe('cell <-> coordinate', () => {
  test('rowLat/colLon land back in the same cell', () => {
    for (const lat of [89.99, 47.6, 0.001, -0.001, -33.87, -89.99]) {
      const r = cellRow(lat);
      expect(cellRow(rowLat(r))).toBe(r);
      expect(Math.abs(rowLat(r) - lat)).toBeLessThanOrEqual(CELL_DEG);
    }
    for (const lon of [-179.99, -122.33, 0, 0.004, 103.8, 179.99]) {
      const c = cellCol(lon);
      expect(cellCol(colLon(c))).toBe(c);
      expect(Math.abs(colLon(c) - lon)).toBeLessThanOrEqual(CELL_DEG);
    }
  });

  test('row 0 is the north pole, last row the south pole', () => {
    expect(cellRow(90)).toBe(0);
    expect(cellRow(89.999)).toBe(0);
    expect(cellRow(-90)).toBe(ROWS - 1);
    expect(cellRow(95)).toBe(0);         // clamped
    expect(cellRow(-95)).toBe(ROWS - 1); // clamped
  });

  test('longitude wraps across the antimeridian', () => {
    expect(cellCol(-180)).toBe(0);
    expect(cellCol(180)).toBe(0);
    expect(cellCol(180.004)).toBe(cellCol(-179.996));
    expect(cellCol(-180.004)).toBe(COLS - 1);
    expect(cellCol(540)).toBe(cellCol(180));
    expect(wrapCol(-1)).toBe(COLS - 1);
    expect(wrapCol(COLS)).toBe(0);
    expect(wrapCol(COLS + 5)).toBe(5);
  });

  test('east-west cell size shrinks with latitude', () => {
    expect(cellKmEW(0)).toBeCloseTo(grid.CELL_KM_NS, 6);
    expect(cellKmEW(60)).toBeCloseTo(grid.CELL_KM_NS / 2, 6);
    expect(cellKmEW(90)).toBeCloseTo(0, 6);
  });
});

describe('tiles', () => {
  test('tileId inverses', () => {
    for (const [tr, tc] of [[0, 0], [0, TILE_COLS - 1], [TILE_ROWS - 1, 0], [123, 456], [TILE_ROWS - 1, TILE_COLS - 1]]) {
      const id = tileId(tr, tc);
      expect(tileRowFromId(id)).toBe(tr);
      expect(tileColFromId(id)).toBe(tc);
    }
    expect(tileId(1, 0)).toBe(TILE_COLS);
  });

  test('tileRowOf/tileColOf and cellIndexInTile', () => {
    const row = 5 * TILE + 7, col = 9 * TILE + 3;
    expect(tileRowOf(row)).toBe(5);
    expect(tileColOf(col)).toBe(9);
    expect(cellIndexInTile(row, col)).toBe(7 * TILE + 3);
    expect(cellIndexInTile(0, 0)).toBe(0);
    expect(cellIndexInTile(TILE - 1, TILE - 1)).toBe(TILE_CELLS - 1);
  });

  test('tileBounds covers 0.5 degree and contains its cells', () => {
    const b = tileBounds(tileRowOf(cellRow(47.6)), tileColOf(cellCol(-122.3)));
    expect(b.north - b.south).toBeCloseTo(0.5, 9);
    expect(b.east - b.west).toBeCloseTo(0.5, 9);
    expect(47.6).toBeLessThanOrEqual(b.north);
    expect(47.6).toBeGreaterThanOrEqual(b.south);
    expect(-122.3).toBeLessThanOrEqual(b.east);
    expect(-122.3).toBeGreaterThanOrEqual(b.west);
    expect(tileBounds(0, 0)).toEqual({ north: 90, south: 89.5, west: -180, east: -179.5 });
  });
});

describe('TileStore', () => {
  test('add accumulates and only allocates touched tiles', () => {
    const s = new TileStore();
    const row = cellRow(47.6), col = cellCol(-122.3);
    s.add(row, col, 1.5);
    s.add(row, col, 2.5);
    s.add(row + 1, col, 1);
    expect(s.tiles.size).toBe(1);
    const t = s.get(tileRowOf(row), tileColOf(col), false);
    expect(t[cellIndexInTile(row, col)]).toBe(4);
    expect(t[cellIndexInTile(row + 1, col)]).toBe(1);
    expect(s.get(0, 0, false)).toBeUndefined();
  });

  test('toBuffer/fromBuffer/addBuffer round trip', () => {
    const s = new TileStore();
    s.add(100, 200, 3);
    s.add(ROWS - 1, COLS - 1, 7);
    s.add(5000, 40000, 0.25);
    const buf = s.toBuffer();
    expect(buf.readUInt32LE(0)).toBe(3);
    expect(buf.length).toBe(4 + 3 * (4 + TILE_CELLS * 8));

    const back = TileStore.fromBuffer(buf);
    expect([...back.tiles.keys()].sort()).toEqual([...s.tiles.keys()].sort());
    for (const [id, tile] of s.tiles) {
      expect(Array.from(back.tiles.get(id))).toEqual(Array.from(tile));
    }

    back.addBuffer(buf); // summing merge
    expect(back.get(tileRowOf(100), tileColOf(200))[cellIndexInTile(100, 200)]).toBe(6);
    expect(back.get(tileRowOf(ROWS - 1), tileColOf(COLS - 1))[cellIndexInTile(ROWS - 1, COLS - 1)]).toBe(14);
    expect(back.tiles.size).toBe(3);
  });

  test('owns filter drops cells in unowned tile columns', () => {
    const owned = new TileStore(tc => tc % 2 === 0);
    owned.add(10, 0 * TILE + 1, 1);   // tile col 0: owned
    owned.add(10, 1 * TILE + 1, 1);   // tile col 1: not owned
    owned.add(10, 2 * TILE + 1, 1);   // tile col 2: owned
    expect(owned.tiles.size).toBe(2);
    expect(owned.get(0, 1, false)).toBeUndefined();
    expect(owned.get(0, 2, false)[cellIndexInTile(10, 2 * TILE + 1)]).toBe(1);
  });
});

describe('TimeAboveStore', () => {
  const { TimeAboveStore } = require('../lib/noise/grid');
  test('overlapping aircraft in one snapshot count once and never exceed the interval', () => {
    const store = new TimeAboveStore();
    const t = store.tile(10, 20);
    TimeAboveStore.add(t, 7, 5, 0, 5);   // aircraft A, snapshot 0
    TimeAboveStore.add(t, 7, 5, 0, 5);   // aircraft B, same snapshot: no extra time
    TimeAboveStore.add(t, 7, 2.5, 1, 5); // snapshot 1, two sub-samples of 2.5 s
    TimeAboveStore.add(t, 7, 2.5, 1, 5);
    TimeAboveStore.add(t, 7, 2.5, 1, 5); // a third aircraft: capped
    expect(t.values[7]).toBeCloseTo(10, 6);
    expect(store.size).toBe(1);
    const { ids, buffers } = store.transferable();
    expect(ids.length).toBe(1);
    expect(new Float64Array(buffers[0])[7]).toBeCloseTo(10, 6);
    expect(store.size).toBe(0);
  });
});
