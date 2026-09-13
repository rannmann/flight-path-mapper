# Flight Path Mapper

A planet-wide map of aircraft noise, built from one day of ADS-B Exchange
position data and served as static image tiles from GitHub Pages. A second,
smaller product draws the actual flight paths around a set of cities.

The idea is simple: every aircraft snapshot (17,280 of them, 5 s apart)
becomes a moving noise source; the ground beneath it receives a level that
falls off with distance; those levels are integrated over the whole day
into a **Day-Night Average Sound Level (DNL)** for every 30 arc-second cell
on Earth. The result shows which neighbourhoods sit under approach paths,
next to runways, or beneath cruise corridors, and which are quiet.

## The metric, in plain language

DNL is the standard airport-noise metric used by the FAA and the EU. It is
the average sound energy over 24 hours, with every event between 22:00 and
07:00 counted as ten times louder because sleep matters. 65 dB DNL is the
US threshold for "significant" exposure; 55 dB is where most people start
to notice; below 45 dB aircraft are rarely the dominant sound.

Caveats you should know before trusting a number:

* **One day.** Runway direction, weather and schedules change daily. This
  is one Friday in September 2023, not a yearly average.
* **Approximate source levels.** Aircraft loudness comes from a small table
  indexed by ADS-B emitter category (light, narrow-body, heavy, helicopter,
  ...) and flight phase (takeoff, climb, approach, taxi, ...). Real
  certification data varies by type and engine; the table is within a few
  dB of published values but is a calibration knob, not a measurement.
* **Simple propagation.** Spherical spreading, a fixed air absorption, and
  the standard lateral-attenuation curve. No terrain shielding, no wind,
  no buildings.
* **Coverage gaps.** ADS-B Exchange sees what its receivers see. Oceans,
  parts of Africa and Asia, and low-altitude traffic away from receivers
  are under-reported; satellite (ADS-C) positions are minutes old and are
  skipped.
* **Local solar time** decides day vs. night, not time zones.

Treat the map as a relative guide ("this street is 10 dB louder than that
one") rather than an absolute measurement. DESIGN.md has the full model.

## Quick start

Requires Node 18+ and, for the terrain step only, Python 3 with `numpy`
and `h5py`. Budget about 20 GB of disk for the raw snapshots.

```bash
npm install
npm run setup              # creates the data/ directories
npm run download           # ~17k gzip snapshots for DEFAULT_DATE (~16 GB)
npm run download:terrain   # ETOPO 2022 DEM (under 1 GB) and OurAirports CSV
npm run terrain            # python: builds data/terrain/elevation.bin + airports.json
npm run noise:test         # quick check on 1/40th of the snapshots
npm run noise              # full day: data/noise/<date>/{dnl,traffic}.0.tiles (~11 min on 12 cores, ~15 GB RAM)
npm run tiles              # data/tiles/: Web Mercator value tiles as PNG
npm run build              # docs/: the static site (GitHub Pages root)
npm start                  # preview docs/ at http://localhost:3000
```

`npm run days -- --dates 2025-10-01,2025-11-01,...` builds the site from
several days at once: for each date it downloads the archive, generates the
grids and deletes the snapshots again (about 20 GB per day; pass `--keep`
to keep them), overlapping the next download with the current generation.
The days are then averaged with `npm run merge` into `data/noise/merged/`
and rendered from there. ADS-B Exchange publishes a full day for the first
of every month, so those are the dates to use.

`npm run all` runs `noise`, `tiles` and `build` in sequence. `npm run paths`
generates the per-city flight path GeoJSON (see below); `npm run build`
keeps whatever flight paths are already published in `docs/data/flightpaths/`
unless you pass `--flightpaths` (replace) or `--no-flightpaths` (drop).
`npm run clean` removes generated noise, tiles and the site but keeps the
downloaded data.

`npm run download -- --verify` re-checks every existing snapshot with gunzip
and re-downloads corrupt ones. Snapshots that still fail to parse are
logged and skipped by the generators, never deleted.

## Configuration

Everything lives in `config.js`; the parts you are likely to change can be
set through the environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEFAULT_DATE` | `2023-09-01` | Day of ADS-B Exchange sample data (`YYYY-MM-DD`) |
| `WORKER_THREADS` | CPUs - 2 | Worker threads for the generators |
| `CONCURRENCY_LIMIT` | `10` | Parallel downloads |
| `DEFAULT_RADII` | `80` | Miles around each city for flight paths (comma list) |
| `LIGHTWEIGHT_MODE` | `false` | Flight paths only: read every other snapshot |
| `PORT`, `HOST` | `3000`, `localhost` | Preview server |
| `LOG_LEVEL` | `INFO` | `ERROR`, `WARN`, `INFO` or `DEBUG` |

Paths (`config.paths`) are fixed and relative to the repository root.

## Output layout

```
data/flight-history/<date>/   HHMMSSZ.json.gz snapshots (input)
data/terrain/                 elevation.bin, elevation.json, airports.json
data/noise/<date>/            dnl.0.tiles (energy grid), traffic.0.tiles (seconds of
                              presence per cell), above45.0.tiles (seconds with at least
                              one aircraft at 45 dB or louder), manifest.json
data/tiles/<layer>/<z>/       greyscale PNG metatiles (8 x 8 tiles of 256 px)
data/flightpaths/             <city>_<radius>_miles.json + metadata.json
data/noise/merged/            average of several days (npm run merge)
docs/                         static site: index.html, data/tiles/, meta.json
```

Tile pixels store the value, not a colour: for `dnl`, `v = (dB - 30) * 4`
(0 = below the 35 dB cutoff); for `traffic` and `above45`, `v = 40 log10(1 + seconds)`.
The page colours them on a canvas, so the legend and threshold slider
work without regenerating anything.

## Model summary

1. **Source** (`lib/noise/categories.js`, `phase.js`): each record gets a
   reference level (LAmax at 305 m) from emitter category x phase. Phase
   comes from height above ground, vertical rate and ground speed.
2. **Terrain** (`lib/noise/terrain.js`): ETOPO 2022 at 2 arc-minutes,
   overridden by the nearest airport elevation within 15 km, gives height
   above ground.
3. **Propagation** (`lib/noise/propagation.js`): spherical spreading from
   305 m, 1 dB/km absorption, SAE AIR 5662 lateral attenuation. Levels
   below 35 dB are dropped.
4. **Time integration** (`lib/noise/observations.js`): successive positions
   of the same aircraft are interpolated to 500 m steps, each carrying its
   share of the 5 s interval; night samples are weighted x10.
5. **Grid** (`lib/noise/grid.js`): a fixed 120 cells/degree plate carree
   grid in 0.5 degree tiles, only allocated where touched.

DESIGN.md explains the reasoning, the formulas and why the previous
per-city heatmap was replaced.

## Flight paths (secondary product)

`npm run paths` reads the same snapshots and writes one GeoJSON
FeatureCollection per city and radius to `data/flightpaths/`. Each feature
is one aircraft (`properties: {hex, flight, type}`) as a MultiLineString;
gaps longer than 60 s between positions start a new line part. Use
`--limit N` and `--stride K` for quick test runs.

The published site keeps its own curated copy of these files; see
DEPLOYMENT.md for how `npm run build` treats them. To publish a new set,
run `npm run paths` and then `npm run build -- --flightpaths`.

### Adding cities

Add an entry to `cities` in `config.js` using the `<country>_<region>_<Name>`
key style and rerun `npm run paths`:

```javascript
'USA_TX_Austin': { lat: 30.2672, lon: -97.7431 },
'ITA_Rome': { lat: 41.9028, lon: 12.4964 },
```

The noise map is global and needs no city list.

## Development

```bash
npm test                          # jest unit tests for every model module
npm run test:watch
node scripts/inspect-noise.js     # DNL at known places, histogram, loudest cells
node scripts/inspect-noise.js 47.6,-122.3,Home   # add your own points
```

`inspect-noise.js` is the quickest way to judge a calibration change:
edit `lib/noise/categories.js`, run `npm run noise:test`, and compare the
printed levels with published DNL contours for airports you know.

## Data sources

* Positions: [ADS-B Exchange](https://www.adsbexchange.com/) readsb-hist samples
* Elevation: [NOAA ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model)
* Airports: [OurAirports](https://ourairports.com/data/)
* Base map: OpenStreetMap via Leaflet

## License

ISC
