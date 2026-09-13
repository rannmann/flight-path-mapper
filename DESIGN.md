# Global aircraft noise map: design

This document describes the v2 pipeline that replaces the per-city heatmap.
It turns one day of ADS-B Exchange snapshots (5 s interval, ~17,280 files)
into a planet-wide Day-Night Average Sound Level (DNL) raster and a traffic
density raster, both served as static image tiles.

## Why the old model was replaced

* Levels were averaged per observation instead of per unit time, so a cell
  with one loud sighting outranked a runway with continuous traffic.
* Noise was only deposited in the aircraft's own 1 km cell; no spreading.
* The received level depended on the aircraft's random offset from its own
  cell centre (up to 40 dB of jitter for ground aircraft).
* Altitude was MSL, not above ground, so Denver never saw a takeoff.
* Per-city grids anchored on the city centre could not be merged.

## Metric

DNL = 10 log10( (1/86400) * sum_i w_i * 10^(L_i/10) * dt_i )

* `L_i` is the A-weighted level a receiver cell sees from one aircraft
  sample, `dt_i` the seconds that sample represents, `w_i` = 10 between
  22:00 and 07:00 local solar time, else 1.
* Local solar time = UTC + longitude / 15 h. Good enough for a day/night
  split; a timezone database can replace it later.

## Source model (`lib/noise/categories.js`, `lib/noise/phase.js`)

Each observation gets a reference level `L_ref` = LAmax at 305 m (1000 ft)
slant distance, chosen from a table indexed by ADS-B emitter category and
flight phase. Phase comes from height above ground, vertical rate, and
ground speed. The table values are approximations of published LAmax data
(FAA AC 36-1H, AEDT/ANP NPD curves, EASA certification levels) and are the
main calibration knob. They live in one place and are documented inline.

Records that are not aircraft (surface vehicles, obstacles, categories C*
and D*, non-transponder emitters), skydivers, gliders, balloons, drones
and stale positions (`seen_pos` > 10 s) are skipped.

## Propagation (`lib/noise/propagation.js`)

L = L_ref - 20 log10(d / 305 m) - a_atm * d - A_lat(l, beta)

* `d` slant distance combined with a 180 m receiver offset, because a
  1 km cell is an area, not a point: the energy-mean of 1/d^2 over a 500 m
  disk around a source is the level at ~180 m. Without it a parked
  aircraft on a cell centre would dominate the cell.
* `a_atm` = 1.0 dB/km (A-weighted broadband, ISO 9613-1
  at 15 C / 70% RH is 0.5-2 dB/km).
* `A_lat` is SAE AIR 5662 lateral attenuation: G(l) ground-to-ground term by
  lateral distance and Lambda(beta) by elevation angle. This is what keeps
  taxiing aircraft from painting 10 km circles.
* Cells below the 35 dB cutoff receive nothing.

Height above ground comes from ETOPO 2022 downsampled to 2 arc-minutes,
overridden by the nearest OurAirports elevation within 15 km.

## Time integration (`lib/noise/observations.js`)

Consecutive positions of the same hex code are linearly interpolated so
that no sample is more than 500 m from the last; each sub-sample carries
its share of the interval in seconds. Jets at cruise move 1.2 km per
snapshot, which would otherwise leave gaps in 0.9 km cells.

## Time above 45 dB

A third layer counts, per cell, the clock seconds per day during which at
least one aircraft is received at 45 dB or louder. It is deduplicated per
snapshot (`TimeAboveStore` in grid.js): a cell is credited at most the
snapshot spacing (5 s) per snapshot however many aircraft are overhead, so
it can never exceed 86,400 s per day. It exists because DNL is
an energy average: a single loud overflight and a continuous faint hum can
share a DNL value, and people who are sensitive to sound care about the
former. 45 dB is roughly "clearly audible indoors in a quiet room".

## Grid (`lib/noise/grid.js`)

Fixed global plate carree grid, 120 cells per degree (30 arc-seconds,
0.93 km north-south, 0.93 km * cos(lat) east-west). Cells are grouped in
0.5 degree tiles of 60 x 60 cells stored as Float64 energy sums; only
touched tiles are allocated.

## Pipeline

1. `scripts/prepare-terrain.py` builds `data/terrain/elevation.bin` and
   `data/terrain/airports.json` (run once).
2. `scripts/generate-noise.js` runs N worker threads. Each worker owns an
   interleaved subset of tile columns, reads every snapshot in time order,
   and deposits energy into its own tiles, handing them to the main thread
   every 100 files. Output: `data/noise/<date>/{dnl,traffic,above45}.0.tiles`.
3. `scripts/render-tiles.js` converts the sparse grid into Web Mercator
   image tiles. Pixels store the value, not a colour: for the `dnl` layer
   `v = round((dB - 30) * 4)` clamped to 1..255 (0 = below cutoff); for
   `traffic` and `above45` `v = round(40 * log10(1 + seconds))`. Seconds
   layers are averaged over the whole pixel at low zoom (empty cells count
   as zero) so sparse coverage fades instead of lighting up pixels; the DNL
   layer averages energy over contributing cells only so airports stay
   visible at any zoom. Tiles are packed 8 x 8
   into 2048 px "metatiles" to keep the file count small.
4. `scripts/build-site.js` assembles `docs/` (the GitHub Pages root).

The browser colours the value tiles on a canvas, so the legend, threshold
slider and hover readout work without regenerating data.

## Several days

ADS-B Exchange publishes a full day of snapshots for the first of every
month. `scripts/merge-noise.js` averages any number of generated days:
every grid holds a linear per-day quantity (sound energy times seconds for
DNL, seconds for the other two layers), so the merged cell is the sum over
days divided by the number of days, including days on which the cell was
silent. DNL of the mean energy is the multi-day DNL in the same sense as
an annual-average DNL. The seconds layers become mean seconds per day.

One day is a poor sample for bursty sources: on 2023-09-01 there were
exactly two air-ambulance flights and one police patrol over Toronto, so
the hospital helipads showed nothing but airport traffic. Twelve first-of-
month days cover every weekday at least once and smooth that out.

## Helicopters without a category

Roughly one record in six has no emitter category. The speed-based
fallback would file a helicopter as a light piston aircraft, 12 dB too
quiet in level flight, so `effectiveCategory` first checks the ICAO type
designator (`t` in the snapshots) against a list of helicopter types and
assigns A7 when it matches. Speed itself never enters the source level:
levels are per second, so a slow or hovering helicopter simply deposits
more seconds into the same cells.
