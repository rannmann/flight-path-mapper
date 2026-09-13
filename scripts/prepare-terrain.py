#!/usr/bin/env python3
"""
Build the terrain inputs for the noise pipeline.

  data/terrain/elevation.bin   int16 little-endian, 5400 rows x 10800 cols,
                               2 arc-minute cells, row 0 = 90N, col 0 = 180W,
                               metres above sea level (ocean is negative).
  data/terrain/elevation.json  dimensions / provenance
  data/terrain/airports.json   [[lat, lon, elevation_ft], ...]

Inputs (downloaded by `npm run download:terrain`):
  data/terrain/ETOPO_2022_v1_60s_N90W180_surface.nc  (NOAA ETOPO 2022, 60 arc-second)
  data/terrain/airports.csv                           (OurAirports)
"""
import csv, json, os, sys
import numpy as np
import h5py

HERE = os.path.dirname(os.path.abspath(__file__))
TERRAIN = os.path.join(HERE, '..', 'data', 'terrain')
NC = os.path.join(TERRAIN, 'ETOPO_2022_v1_60s_N90W180_surface.nc')
CSV = os.path.join(TERRAIN, 'airports.csv')
FACTOR = 2  # 60 arc-second -> 2 arc-minute

def build_dem():
    with h5py.File(NC, 'r') as f:
        lat = f['lat'][:]
        z = f['z']
        rows, cols = z.shape
        out = np.zeros((rows // FACTOR, cols // FACTOR), dtype=np.int16)
        chunk = 600  # source rows per read
        for r0 in range(0, rows, chunk):
            block = z[r0:r0 + chunk, :].astype(np.float32)
            block = np.nan_to_num(block, nan=0.0)
            h = block.shape[0] // FACTOR
            block = block[:h * FACTOR].reshape(h, FACTOR, cols // FACTOR, FACTOR).mean(axis=(1, 3))
            out[r0 // FACTOR: r0 // FACTOR + h] = np.clip(np.round(block), -32768, 32767).astype(np.int16)
            print(f'  rows {r0 + block.shape[0] * FACTOR}/{rows}', file=sys.stderr, end='\r')
        if lat[0] < lat[-1]:  # south-first storage: flip so row 0 is north
            out = out[::-1]
    out.tofile(os.path.join(TERRAIN, 'elevation.bin'))
    meta = {
        'rows': int(out.shape[0]), 'cols': int(out.shape[1]),
        'cellDeg': 360.0 / out.shape[1], 'dtype': 'int16le', 'units': 'm',
        'row0': 'north', 'col0': 'west',
        'source': 'NOAA ETOPO 2022 v1 60 arc-second surface, 2x2 mean'
    }
    with open(os.path.join(TERRAIN, 'elevation.json'), 'w') as fh:
        json.dump(meta, fh, indent=2)
    print(f'\nDEM written: {out.shape}, range {out.min()}..{out.max()} m', file=sys.stderr)

def build_airports():
    keep = {'large_airport', 'medium_airport', 'small_airport', 'heliport', 'seaplane_base'}
    rows = []
    with open(CSV, newline='', encoding='utf-8') as fh:
        for rec in csv.DictReader(fh):
            if rec['type'] not in keep or not rec['elevation_ft']:
                continue
            try:
                rows.append([round(float(rec['latitude_deg']), 4),
                             round(float(rec['longitude_deg']), 4),
                             int(float(rec['elevation_ft']))])
            except ValueError:
                continue
    with open(os.path.join(TERRAIN, 'airports.json'), 'w') as fh:
        json.dump(rows, fh, separators=(',', ':'))
    print(f'Airports written: {len(rows)}', file=sys.stderr)

if __name__ == '__main__':
    if not os.path.exists(NC) or not os.path.exists(CSV):
        sys.exit('Missing inputs in data/terrain; run `npm run download:terrain` first.')
    build_dem()
    build_airports()
