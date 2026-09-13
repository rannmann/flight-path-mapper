const { Terrain, AIRPORT_RADIUS_KM } = require('../lib/noise/terrain');

// 4 rows x 8 cols DEM: 45 degree rows, 45 degree columns. Cell value = row * 100 + col.
function makeDem(rows, cols, valueOf) {
  const buf = new ArrayBuffer(rows * cols * 2);
  const dem = new Int16Array(buf);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) dem[r * cols + c] = valueOf(r, c);
  return buf;
}

const ROWS = 4, COLS = 8;
const AIRPORTS = [
  [47.45, -122.31, 433],  // SEA
  [52.31, 4.76, -11]      // AMS, below sea level
];

describe('Terrain', () => {
  const terrain = new Terrain(makeDem(ROWS, COLS, (r, c) => r * 100 + c), { rows: ROWS, cols: COLS }, AIRPORTS);

  test('demElevationM: row 0 is north, col 0 is west', () => {
    expect(terrain.demElevationM(89, -179)).toBe(0);      // r0 c0
    expect(terrain.demElevationM(89, 179)).toBe(7);       // r0 c7
    expect(terrain.demElevationM(-89, -179)).toBe(300);   // r3 c0
    expect(terrain.demElevationM(-89, 179)).toBe(307);    // r3 c7
    expect(terrain.demElevationM(10, 10)).toBe(104);      // r1 c4
    expect(terrain.demElevationM(-10, -10)).toBe(203);    // r2 c3
  });

  test('demElevationM clamps latitude and wraps longitude', () => {
    expect(terrain.demElevationM(90, 0)).toBe(4);
    expect(terrain.demElevationM(-90, 0)).toBe(304);
    expect(terrain.demElevationM(89, 181)).toBe(0);       // wraps to col 0
    expect(terrain.demElevationM(89, -181)).toBe(7);      // wraps to col 7
    expect(terrain.demElevationM(89, 541)).toBe(0);
  });

  test('airport elevation overrides the DEM within 15 km', () => {
    expect(AIRPORT_RADIUS_KM).toBe(15);
    expect(terrain.airportElevationFt(47.5, -122.31)).toBe(433);   // 5.6 km
    expect(terrain.airportElevationFt(47.45, -122.5)).toBe(433);   // 14.3 km
    expect(terrain.elevationFt(47.5, -122.31)).toBe(433);
  });

  test('no airport override beyond 15 km', () => {
    expect(terrain.airportElevationFt(47.6, -122.31)).toBeNull();  // 16.7 km
    expect(terrain.airportElevationFt(47.45, -121.9)).toBeNull();  // 31 km
    // DEM row 0 col 1 (lat 47.6, lon -122.31) = 1 m -> 3.28 ft
    expect(terrain.elevationFt(47.6, -122.31)).toBeCloseTo(1 * 3.28084, 6);
  });

  test('elevationFt never returns below sea level', () => {
    const ocean = new Terrain(makeDem(ROWS, COLS, () => -4000), { rows: ROWS, cols: COLS }, AIRPORTS);
    expect(ocean.demElevationM(0, 0)).toBe(-4000);
    expect(ocean.elevationFt(0, 0)).toBe(0);
    expect(ocean.elevationFt(52.31, 4.76)).toBe(0); // AMS is -11 ft
    expect(terrain.elevationFt(52.31, 4.76)).toBe(0);
  });

  test('toTransferable/fromTransferable rebuild an equivalent lookup', () => {
    const copy = Terrain.fromTransferable(terrain.toTransferable());
    expect(copy.demElevationM(-10, -10)).toBe(203);
    expect(copy.elevationFt(47.5, -122.31)).toBe(433);
  });
});
