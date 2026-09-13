#!/usr/bin/env node
/**
 * Assemble docs/ (the GitHub Pages root) from site/ and data/tiles/, and
 * write docs/data/config.json for the pages.
 *
 * Flight path GeoJSON is handled separately from the rest of docs/: the
 * files already published in docs/data/flightpaths/ are kept as they are
 * (the hosted set is a curated, mostly 20 mile radius collection that is
 * not regenerated with every noise run).
 *
 *   node scripts/build-site.js                 keep docs/data/flightpaths/ as is
 *   node scripts/build-site.js --flightpaths   replace it with data/flightpaths/
 *   node scripts/build-site.js --no-flightpaths  ship no flight paths at all
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'site');
const DOCS_DIR = path.join(ROOT, 'docs');
const TILES_DIR = path.join(ROOT, 'data', 'tiles');
const FLIGHTPATHS_DIR = path.join(ROOT, 'data', 'flightpaths');

/** "USA_CA_LosAngeles" -> "Los Angeles, CA, USA" (mirrored in site/js/flightpaths.js). */
function cityDisplayName(key) {
    const parts = String(key).split('_').filter(Boolean);
    if (!parts.length) return String(key);
    const city = parts[parts.length - 1]
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Za-z])(\d)/g, '$1 $2');
    const prefixes = parts.slice(0, -1).reverse();
    return [city, ...prefixes].join(', ');
}

function citiesFromConfig(config) {
    const cities = (config && config.cities) || {};
    return Object.keys(cities)
        .filter(key => cities[key] && Number.isFinite(cities[key].lat) && Number.isFinite(cities[key].lon))
        .map(key => ({ key, name: cityDisplayName(key), lat: cities[key].lat, lon: cities[key].lon }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function readJsonIfExists(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

function dirSize(dir) {
    let bytes = 0, files = 0;
    const walk = d => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.isFile()) { bytes += fs.statSync(p).size; files++; }
        }
    };
    if (fs.existsSync(dir)) walk(dir);
    return { bytes, files };
}

function human(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

/**
 * @param {object} [opts]
 * @param {'keep'|'refresh'|'none'} [opts.flightpaths='keep'] what to do with
 *        docs/data/flightpaths/: keep the published files, replace them from
 *        data/flightpaths/, or ship none.
 */
function build({
    flightpaths = 'keep', log = console.log, config = require(path.join(ROOT, 'config')),
    docsDir = DOCS_DIR, siteDir = SITE_DIR, tilesDir = TILES_DIR, flightpathsDir = FLIGHTPATHS_DIR
} = {}) {
    const summary = [];
    if (!['keep', 'refresh', 'none'].includes(flightpaths)) throw new Error(`flightpaths must be keep, refresh or none (got ${flightpaths})`);

    // 1. Fresh docs/, but set the published flight paths aside first if we are keeping them.
    const fpDest = path.join(docsDir, 'data', 'flightpaths');
    const fpKeep = path.join(path.dirname(docsDir), '.flightpaths-keep');
    fs.rmSync(fpKeep, { recursive: true, force: true });
    if (flightpaths === 'keep' && fs.existsSync(fpDest)) fs.renameSync(fpDest, fpKeep);
    fs.rmSync(docsDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(docsDir, 'data'), { recursive: true });
    if (fs.existsSync(fpKeep)) fs.renameSync(fpKeep, fpDest);

    // 2. Static site
    if (!fs.existsSync(siteDir)) throw new Error(`site directory not found: ${siteDir}`);
    fs.cpSync(siteDir, docsDir, { recursive: true });
    summary.push(['site/', dirSize(siteDir)]);

    // 3. Value tiles
    const meta = readJsonIfExists(path.join(tilesDir, 'meta.json'));
    if (fs.existsSync(tilesDir)) {
        fs.cpSync(tilesDir, path.join(docsDir, 'data', 'tiles'), { recursive: true });
        summary.push(['data/tiles/', dirSize(tilesDir)]);
        if (!meta) log('warning: data/tiles/meta.json not found; the noise map will fall back to defaults');
    } else {
        log('warning: data/tiles/ not found; skipping (run scripts/render-tiles.js first)');
    }

    // 4. Flight path GeoJSON (large, curated separately from the noise data)
    let flightpathCount = 0;
    if (flightpaths === 'keep') {
        if (fs.existsSync(fpDest)) {
            flightpathCount = fs.readdirSync(fpDest).filter(n => n.endsWith('.json') && n !== 'metadata.json').length;
            summary.push(['data/flightpaths/', dirSize(fpDest)]);
            log('note: kept the published docs/data/flightpaths/ (pass --flightpaths to replace it from data/flightpaths/)');
        } else {
            log('note: no published docs/data/flightpaths/ to keep; the flight paths page will list nothing');
        }
    } else if (flightpaths === 'refresh' && fs.existsSync(flightpathsDir)) {
        const dest = fpDest;
        fs.mkdirSync(dest, { recursive: true });
        // Only ship what metadata.json lists, so stale files from earlier runs stay behind.
        const metaPath = path.join(flightpathsDir, 'metadata.json');
        let wanted = null;
        if (fs.existsSync(metaPath)) {
            const fpMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (Array.isArray(fpMeta.files)) wanted = new Set(fpMeta.files.map(f => f.file || f.filename || f));
        }
        for (const name of fs.readdirSync(flightpathsDir)) {
            if (!name.endsWith('.json')) continue;
            if (wanted && name !== 'metadata.json' && !wanted.has(name)) continue;
            fs.copyFileSync(path.join(flightpathsDir, name), path.join(dest, name));
            flightpathCount++;
        }
        summary.push(['data/flightpaths/', dirSize(dest)]);
    } else if (flightpaths === 'refresh') {
        log('note: data/flightpaths/ not found; skipping (run npm run paths first)');
    } else {
        log('note: shipping no flight paths (--no-flightpaths)');
    }

    // 5. Site config
    const siteConfig = {
        date: (meta && meta.date) || config.defaultDate || null,
        cities: citiesFromConfig(config),
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(docsDir, 'data', 'config.json'), JSON.stringify(siteConfig, null, 2) + '\n');

    // 6. GitHub Pages: serve files as-is
    fs.writeFileSync(path.join(docsDir, '.nojekyll'), '');

    // Summary
    const total = dirSize(docsDir);
    log(`Built ${path.relative(process.cwd(), docsDir)}/`);
    for (const [label, s] of summary) log(`  ${label.padEnd(20)} ${String(s.files).padStart(6)} files  ${human(s.bytes).padStart(10)}`);
    log(`  ${'total'.padEnd(20)} ${String(total.files).padStart(6)} files  ${human(total.bytes).padStart(10)}`);
    log(`  cities: ${siteConfig.cities.length}, flight path files: ${flightpathCount}, tiles maxZoom: ${meta ? meta.maxZoom : 'n/a'}`);

    return { docsDir: docsDir, config: siteConfig, meta, total, flightpathCount };
}

module.exports = { build, cityDisplayName, citiesFromConfig };

if (require.main === module) {
    const args = process.argv.slice(2);
    const flightpaths = args.includes('--no-flightpaths') ? 'none' : args.includes('--flightpaths') ? 'refresh' : 'keep';
    try {
        build({ flightpaths });
    } catch (err) {
        console.error(`build-site failed: ${err.message}`);
        process.exit(1);
    }
}
