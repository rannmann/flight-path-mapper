# Flight Path Mapper - Claude Code Context

## Project Overview

**Flight Path Mapper** turns one day of global ADS-B Exchange snapshots
(5-second interval, ~17,280 gzipped JSON files) into two planet-wide static
map layers:

1. **Aircraft noise** - Day-Night Average Sound Level (DNL) estimated with a
   category-based source model, SAE AIR 5662 lateral attenuation and ETOPO
   terrain for height above ground. See `DESIGN.md` for the model.
2. **Traffic density** - seconds of aircraft presence per ~1 km cell.
3. **Time above 45 dB** - clock seconds per day with at least one aircraft
   audible at 45 dB or more (deduplicated, never exceeds 24 h).

Both are rendered as greyscale "value tiles" (Web Mercator PNG metatiles)
that the browser colours on a canvas, so the whole site is static and can
be hosted on GitHub Pages from `docs/`. Per-city flight path GeoJSON files
are a secondary product; the published set in `docs/data/flightpaths/` is
curated by hand and not rebuilt with the noise data.

**Main language**: JavaScript (Node.js >= 18, CommonJS). Terrain
preparation is a small Python script (numpy + h5py).

## Layout

- `config.js` - paths, date, cities, worker count
- `download.js` - snapshot and terrain downloads
- `scripts/prepare-terrain.py` - ETOPO 2022 + OurAirports -> `data/terrain/`
- `scripts/generate-noise.js` - worker-thread pipeline -> `data/noise/<date>/`
- `scripts/render-tiles.js` - sparse grid -> `data/tiles/`
- `scripts/build-site.js` - `site/` + tiles -> `docs/` (keeps the published
  `docs/data/flightpaths/` unless `--flightpaths` / `--no-flightpaths`)
- `scripts/inspect-noise.js` - print DNL at known places (sanity checks)
- `index.js` - per-city flight path GeoJSON
- `lib/noise/` - the model: grid, propagation, categories, phase, dnl,
  terrain, observations, png
- `site/` - static front end (vanilla JS + Leaflet)
- `tests/` - Jest

## Commands

- `npm run download` / `npm run download:terrain` / `npm run terrain`
- `npm run noise` (full day) / `npm run noise:test` (1-in-40 stride)
- `npm run tiles` / `npm run build` / `npm start`
- `npm test`

## Conventions

- Calibration constants live in `lib/noise/categories.js` (source levels)
  and `lib/noise/propagation.js` (attenuation). Change them there only.
- Energy is always summed linearly and converted to dB at the end.
- Never apply Claude Code information to commits.
