# Deployment

The site is fully static: `npm run build` writes everything GitHub Pages
needs into `docs/`, including the value tiles, `data/tiles/meta.json`,
and a `.nojekyll` marker so Pages serves the tile directories untouched.

## GitHub Pages

Two options; both serve `docs/` as the site root.

**From the `docs/` folder on a branch** (simplest):

1. Run the pipeline through `npm run build` and commit `docs/`.
2. Repository *Settings > Pages > Build and deployment*: source
   "Deploy from a branch", branch `main` (or whichever you pushed), folder
   `/docs`.

**From a `github-pages` branch**: keep `main` free of generated files,
merge `main` into `github-pages`, run `npm run build` there, commit
`docs/`, and point Pages at that branch with folder `/docs`.

The page is served at `https://<user>.github.io/<repo>/`. Tiles are loaded
with relative URLs, so no base-path configuration is needed.

## What gets committed

`docs/` is intentionally not ignored; `data/` is. Before committing, check
the size: `du -sh docs/data/tiles` and `find docs/data/tiles -type f | wc -l`.
Tiles are packed as 2048 px metatiles (8 x 8 map tiles each) precisely to
keep the file count in the low thousands. The 2023-09-01 planet run at
zoom 0-8 is about 1,500 files and 300 MB: 26 MB for the DNL layer, 167 MB
for traffic density and 104 MB for time above 45 dB. Zoom 8 alone is two
thirds of that, so lowering `maxZoom` in `scripts/render-tiles.js` is the
first lever if the site needs to shrink.

The flight path GeoJSON in `docs/data/flightpaths/` is a curated set (13
cities, mostly 20 mile radius, about 310 MB) that is **not** regenerated
with the noise data. `npm run build` leaves that directory exactly as it
is and rebuilds everything else. Pass `--flightpaths` to replace it with
the output of `npm run paths`, or `--no-flightpaths` to ship none. At an
80 mile radius single files exceed 50 MB, which GitHub warns about, so
shrink `defaultRadii` in `config.js` before regenerating.

GitHub recommends repositories and Pages sites under 1 GB. Every rebuild
of the tiles adds another ~300 MB of binary history, so squash or start a
fresh `github-pages` branch now and then.

The old page URLs (`heatmap.html`, `flightpath.html`) redirect to the
noise map and `flightpaths.html`.

## Local preview

```bash
npm start           # http://localhost:3000 serving docs/
curl localhost:3000/api/status
```

The server only serves files inside `docs/` and answers `/api/status` with
whether `docs/data/tiles/meta.json` exists plus its contents. If `docs/`
is missing it responds with a reminder to run `npm run build`.

## Other static hosts

Any static host works: upload the contents of `docs/` (Netlify: publish
directory `docs`, build command `npm run build` only if the data is
available to the build machine, which it usually is not, so upload the
prebuilt folder instead).
