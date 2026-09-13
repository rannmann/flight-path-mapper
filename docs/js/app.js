/* Aircraft noise map - page logic (vanilla JS, no build step). */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    // Basemap. CARTO Positron (light_all) would suit the overlay better, but
    // basemaps.cartocdn.com now stamps "API KEY REQUIRED" on every tile served
    // without a key, so the standard OSM raster is used instead. Swap the URL
    // (and add a key) here if a CARTO account is set up.
    const BASEMAP = {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    };

    const DEFAULT_VIEW = { lat: 30, lon: -20, zoom: 3 };
    const MAX_ZOOM = 14;

    // ------------------------------------------------------------------
    // Colour helpers
    // ------------------------------------------------------------------

    /** Linear interpolation between [value, [r,g,b,a]] stops. */
    function makeRamp(stops) {
        return function (x) {
            if (x <= stops[0][0]) return stops[0][1];
            const last = stops[stops.length - 1];
            if (x >= last[0]) return last[1];
            for (let i = 1; i < stops.length; i++) {
                const [x1, c1] = stops[i];
                if (x <= x1) {
                    const [x0, c0] = stops[i - 1];
                    const t = (x - x0) / (x1 - x0);
                    return [0, 1, 2, 3].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * t));
                }
            }
            return last[1];
        };
    }

    const rgba = c => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;

    const fmtMinutes = s => {
        const m = s / 60;
        if (m < 1) return `${Math.round(s)} s/day`;
        if (m < 60) return `${m < 10 ? m.toFixed(1) : Math.round(m)} min/day`;
        const h = m / 60;
        return `${h < 10 ? h.toFixed(1) : Math.round(h)} h/day`;
    };

    // ------------------------------------------------------------------
    // Layer definitions (encodings are filled in from meta.json)
    // ------------------------------------------------------------------

    // Light yellow -> orange -> red -> dark purple; alpha is faint below 45 dB.
    const DNL_RAMP = makeRamp([
        [35, [255, 255, 204, 70]],
        [45, [254, 227, 145, 170]],
        [50, [254, 196, 79, 215]],
        [55, [254, 153, 41, 235]],
        [60, [236, 112, 20, 245]],
        [65, [204, 51, 17, 250]],
        [70, [153, 0, 51, 255]],
        [75, [96, 0, 92, 255]],
        [85, [45, 0, 60, 255]]
    ]);

    // Blues on a log scale of seconds-per-day.
    const lg = s => Math.log10(1 + s);
    // Starts at 1 s so that diluted route traces stay visible at world zoom.
    const TRAFFIC_RAMP_LOG = makeRamp([
        [lg(1), [198, 219, 239, 150]],
        [lg(60), [158, 202, 225, 200]],
        [lg(300), [107, 174, 214, 230]],
        [lg(900), [66, 146, 198, 245]],
        [lg(3600), [33, 113, 181, 250]],
        [lg(4 * 3600), [8, 81, 156, 255]],
        [lg(12 * 3600), [8, 48, 107, 255]],
        [lg(48 * 3600), [3, 19, 43, 255]]
    ]);
    const TRAFFIC_RAMP = s => TRAFFIC_RAMP_LOG(lg(s));

    // Greens for time-above: same log scale of seconds-per-day.
    // Low values stay nearly transparent: a couple of minutes a day is background for most people.
    const ABOVE_RAMP_LOG = makeRamp([
        [lg(1), [229, 245, 224, 40]],
        [lg(60), [199, 233, 192, 90]],
        [lg(300), [161, 217, 155, 160]],
        [lg(900), [116, 196, 118, 215]],
        [lg(3600), [65, 171, 93, 245]],
        [lg(4 * 3600), [35, 139, 69, 255]],
        [lg(12 * 3600), [0, 90, 50, 255]],
        [lg(24 * 3600), [0, 50, 30, 255]]
    ]);
    const ABOVE_RAMP = s => ABOVE_RAMP_LOG(lg(s));

    const TRAFFIC_STEPS_MIN = [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720];

    const LAYERS = {
        dnl: {
            key: 'dnl',
            title: 'Noise (DNL)',
            minLabel: 'Hide below',
            decode: v => 30 + v * 0.25,
            palette: DNL_RAMP,
            // slider: 35..80 dB in 1 dB steps
            sliderMax: 45,
            sliderToValue: p => 35 + p,
            valueToSlider: v => Math.min(45, Math.max(0, Math.round(v - 35))),
            formatMin: v => `${v} dB`,
            formatValue: v => `${v.toFixed(1)} dB DNL`,
            hashMin: v => String(Math.round(v)),
            legend: () => ({
                rows: [
                    [35, 45, '35 - 45 dB', 'faint, barely noticeable'],
                    [45, 50, '45 - 50 dB', 'quiet suburban'],
                    [50, 55, '50 - 55 dB', ''],
                    [55, 60, '55 - 60 dB', 'EPA / WHO guidance'],
                    [60, 65, '60 - 65 dB', ''],
                    [65, 70, '65 - 70 dB', 'US federal significance'],
                    [70, 75, '70 - 75 dB', ''],
                    [75, 90, '75 dB and above', '']
                ],
                note: '<b>65 dB DNL</b> is the US federal threshold for significant residential noise exposure (FAA Part 150). <b>55 dB DNL</b> is the EPA / WHO guidance level for outdoor residential areas.'
            })
        },
        traffic: {
            key: 'traffic',
            title: 'Traffic density',
            minLabel: 'Hide below',
            decode: v => Math.pow(10, v / 40) - 1,
            palette: TRAFFIC_RAMP,
            sliderMax: TRAFFIC_STEPS_MIN.length - 1,
            sliderToValue: p => TRAFFIC_STEPS_MIN[p] * 60,
            valueToSlider: v => {
                const m = v / 60;
                let best = 0;
                for (let i = 0; i < TRAFFIC_STEPS_MIN.length; i++) if (TRAFFIC_STEPS_MIN[i] <= m + 1e-9) best = i;
                return best;
            },
            formatMin: v => v <= 0 ? 'show all' : fmtMinutes(v),
            formatValue: v => fmtMinutes(v),
            hashMin: v => String(Math.round(v / 60)),
            legend: () => ({
                rows: [
                    [1, 60, 'under 1 min/day', 'route traces'],
                    [60, 300, '1 - 5 min/day', ''],
                    [300, 900, '5 - 15 min/day', ''],
                    [900, 3600, '15 min - 1 h/day', ''],
                    [3600, 4 * 3600, '1 - 4 h/day', ''],
                    [4 * 3600, 12 * 3600, '4 - 12 h/day', ''],
                    [12 * 3600, 48 * 3600, '12 h/day and above', 'runways, taxiways']
                ],
                note: 'Seconds of aircraft presence per roughly 1 km cell over the day, on a logarithmic scale. Overlapping aircraft add, so busy cells can exceed 24 hours.'
            })
        },
        above45: {
            key: 'above45',
            title: 'Time above 45 dB',
            minLabel: 'Hide below',
            decode: v => Math.pow(10, v / 40) - 1,
            palette: ABOVE_RAMP,
            sliderMax: TRAFFIC_STEPS_MIN.length - 1,
            sliderToValue: p => TRAFFIC_STEPS_MIN[p] * 60,
            valueToSlider: v => {
                const m = v / 60;
                let best = 0;
                for (let i = 0; i < TRAFFIC_STEPS_MIN.length; i++) if (TRAFFIC_STEPS_MIN[i] <= m + 1e-9) best = i;
                return best;
            },
            formatMin: v => v <= 0 ? 'show all' : fmtMinutes(v),
            formatValue: v => fmtMinutes(v),
            hashMin: v => String(Math.round(v / 60)),
            legend: () => ({
                rows: [
                    [1, 60, 'under 1 min/day', 'a brief overflight or two'],
                    [60, 300, '1 - 5 min/day', ''],
                    [300, 900, '5 - 15 min/day', ''],
                    [900, 3600, '15 min - 1 h/day', ''],
                    [3600, 4 * 3600, '1 - 4 h/day', ''],
                    [4 * 3600, 12 * 3600, '4 - 12 h/day', ''],
                    [12 * 3600, 24 * 3600, '12 - 24 h/day', 'airports']
                ],
                note: 'Clock time per day during which at least one aircraft is estimated at <b>45 dB or louder</b> at that cell: about the level that is clearly audible indoors in a quiet room. Overlapping aircraft count once, so this never exceeds 24 h. For people who care about audible events rather than averages. Aircraft only; road and rail noise are not included.'
            })
        }
    };

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    const state = {
        layer: 'dnl',
        min: { dnl: 45, traffic: 0, above45: 300 },
        opacity: 0.8,
        meta: null,
        config: null,
        tileLayer: null,
        pinned: null
    };

    let map;

    // ------------------------------------------------------------------
    // URL hash: #lat,lon,zoom,layer,min
    // ------------------------------------------------------------------

    function readHash() {
        const h = location.hash.replace(/^#/, '');
        if (!h) return null;
        const parts = h.split(',');
        const lat = parseFloat(parts[0]), lon = parseFloat(parts[1]), zoom = parseFloat(parts[2]);
        const out = {};
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90) out.center = [lat, lon];
        if (Number.isFinite(zoom)) out.zoom = Math.min(MAX_ZOOM, Math.max(0, zoom));
        if (parts[3] && LAYERS[parts[3]]) out.layer = parts[3];
        if (parts[4] !== undefined && parts[4] !== '') {
            const m = parseFloat(parts[4]);
            if (Number.isFinite(m)) out.min = m;
        }
        return out;
    }

    let hashTimer = null;
    function writeHash() {
        if (!map) return;
        clearTimeout(hashTimer);
        hashTimer = setTimeout(() => {
            const c = map.getCenter();
            const z = map.getZoom();
            const def = LAYERS[state.layer];
            const parts = [c.lat.toFixed(4), c.lng.toFixed(4), Number.isInteger(z) ? z : z.toFixed(1), state.layer, def.hashMin(state.min[state.layer])];
            const next = '#' + parts.join(',');
            if (location.hash !== next) history.replaceState(null, '', next);
        }, 150);
    }

    // ------------------------------------------------------------------
    // UI helpers
    // ------------------------------------------------------------------

    function setStatus(kind, text) {
        const el = $('status');
        el.className = `status ${kind}`;
        $('statusText').textContent = text;
    }

    let toastTimer;
    function toast(msg) {
        const el = $('toast');
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
    }

    function renderLegend() {
        const def = LAYERS[state.layer];
        const { rows, note } = def.legend();
        $('legendTitle').textContent = def.title;
        const container = $('legendRows');
        container.innerHTML = '';
        for (const [lo, hi, label, hint] of rows) {
            const sw = document.createElement('div');
            sw.className = 'legend-swatch';
            const a = def.palette(lo), b = def.palette((lo + hi) / 2), c = def.palette(hi);
            sw.style.background = `linear-gradient(90deg, ${rgba(a)}, ${rgba(b)}, ${rgba(c)})`;
            const lb = document.createElement('div');
            lb.className = 'legend-label';
            lb.textContent = label;
            if (hint) {
                const em = document.createElement('em');
                em.textContent = ` ${hint}`;
                lb.appendChild(em);
            }
            container.appendChild(sw);
            container.appendChild(lb);
        }
        $('legendNote').innerHTML = note;
    }

    function syncMinControl() {
        const def = LAYERS[state.layer];
        const slider = $('minSlider');
        slider.max = def.sliderMax;
        slider.value = def.valueToSlider(state.min[state.layer]);
        $('minLabel').textContent = def.minLabel;
        $('minValue').textContent = def.formatMin(state.min[state.layer]);
    }

    function applyStyle() {
        if (!state.tileLayer) return;
        state.tileLayer.setStyle({ minValue: state.min[state.layer], opacity: state.opacity });
        writeHash();
        updateReadout(state.pinned && state.pinned.latlng);
    }

    // ------------------------------------------------------------------
    // Layer switching
    // ------------------------------------------------------------------

    function buildTileLayer(key) {
        const def = LAYERS[key];
        const meta = state.meta || {};
        return L.valueTileLayer({
            url: `data/tiles/${key}`,
            metaTileSize: meta.metaTileSize || 8,
            maxNativeZoom: Number.isFinite(meta.maxZoom) ? meta.maxZoom : 8,
            maxZoom: MAX_ZOOM,
            decode: def.decode,
            palette: def.palette,
            minValue: state.min[key],
            opacity: state.opacity,
            attribution: 'Noise model: <a href="https://github.com/rannmann/flight-path-mapper">flight-path-mapper</a>, data: <a href="https://www.adsbexchange.com/">ADS-B Exchange</a>'
        });
    }

    function setLayer(key, { silent } = {}) {
        if (!LAYERS[key]) return;
        state.layer = key;
        document.querySelectorAll('.segmented button[data-layer]').forEach(b => {
            b.setAttribute('aria-pressed', b.dataset.layer === key ? 'true' : 'false');
        });
        if (state.tileLayer) map.removeLayer(state.tileLayer);
        state.tileLayer = buildTileLayer(key).addTo(map);
        state.tileLayer.on('tileerror', e => {
            console.warn('tile error', e.coords, e.error);
        });
        syncMinControl();
        renderLegend();
        if (!silent) writeHash();
        updateReadout(state.pinned && state.pinned.latlng);
    }

    // ------------------------------------------------------------------
    // Readout
    // ------------------------------------------------------------------

    function updateReadout(latlng) {
        const box = $('readout');
        if (!latlng || !state.tileLayer) {
            box.classList.add('empty');
            $('readoutValue').textContent = state.pinned ? '' : 'Hover or tap the map';
            $('readoutSub').textContent = '';
            return;
        }
        const def = LAYERS[state.layer];
        const raw = state.tileLayer.rawValueAt(latlng);
        let text;
        if (raw === null) text = 'Loading...';
        else if (raw === 0) text = def.key === 'dnl' ? 'Below 35 dB / no data' : def.key === 'above45' ? 'Never above 45 dB' : 'No traffic';
        else text = def.formatValue(def.decode(raw));
        box.classList.toggle('empty', !(raw > 0));
        $('readoutValue').textContent = text;
        $('readoutSub').textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}${state.pinned ? '  (pinned, tap again to release)' : ''}`;
    }

    let hoverFrame = null;
    function onHover(e) {
        if (state.pinned) return;
        if (hoverFrame) return;
        hoverFrame = requestAnimationFrame(() => {
            hoverFrame = null;
            updateReadout(e.latlng);
        });
    }

    function onTap(e) {
        if (state.pinned) {
            map.removeLayer(state.pinned.marker);
            state.pinned = null;
            updateReadout(e.latlng);
            return;
        }
        const marker = L.circleMarker(e.latlng, { radius: 6, color: '#1f2933', weight: 2, fillColor: '#fff', fillOpacity: 0.9, interactive: false }).addTo(map);
        state.pinned = { latlng: e.latlng, marker };
        updateReadout(e.latlng);
    }

    // ------------------------------------------------------------------
    // Cities
    // ------------------------------------------------------------------

    function populateCities(config) {
        const select = $('citySelect');
        const cities = (config && Array.isArray(config.cities)) ? config.cities : [];
        if (!cities.length) {
            $('cityField').hidden = true;
            return;
        }
        [...cities].sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => {
            if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
            const opt = document.createElement('option');
            opt.value = c.key || c.name;
            opt.textContent = c.name || c.key;
            opt.dataset.lat = c.lat;
            opt.dataset.lon = c.lon;
            select.appendChild(opt);
        });
        select.addEventListener('change', () => {
            const opt = select.selectedOptions[0];
            if (!opt || !opt.dataset.lat) return;
            map.flyTo([parseFloat(opt.dataset.lat), parseFloat(opt.dataset.lon)], Math.max(map.getZoom(), 10), { duration: 1.2 });
            if (window.matchMedia('(max-width: 640px)').matches) setPanelCollapsed(true);
        });
    }

    // ------------------------------------------------------------------
    // Panel
    // ------------------------------------------------------------------

    function setPanelCollapsed(collapsed) {
        const panel = $('panel');
        panel.classList.toggle('collapsed', collapsed);
        const btn = $('panelToggle');
        btn.textContent = collapsed ? 'Controls' : 'Hide';
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
        return res.json();
    }

    async function init() {
        const hash = readHash() || {};
        if (hash.layer) state.layer = hash.layer;

        map = L.map('map', {
            center: hash.center || [DEFAULT_VIEW.lat, DEFAULT_VIEW.lon],
            zoom: hash.zoom !== undefined ? hash.zoom : DEFAULT_VIEW.zoom,
            minZoom: 2,
            maxZoom: MAX_ZOOM,
            zoomControl: false,
            worldCopyJump: true
        });
        L.control.zoom({ position: 'topright' }).addTo(map);
        L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(map);

        L.tileLayer(BASEMAP.url, {
            maxZoom: MAX_ZOOM,
            attribution: BASEMAP.attribution
        }).addTo(map);

        // Panel state
        $('panelToggle').addEventListener('click', () => setPanelCollapsed(!$('panel').classList.contains('collapsed')));
        if (window.matchMedia('(max-width: 640px)').matches) setPanelCollapsed(true);

        // Load metadata and config in parallel; the page still works without either.
        setStatus('loading', 'Loading tile metadata...');
        const [meta, config] = await Promise.all([
            fetchJson('data/tiles/meta.json').catch(err => { console.warn(err); return null; }),
            fetchJson('data/config.json').catch(err => { console.warn(err); return null; })
        ]);
        state.meta = meta;
        state.config = config;

        if (meta && meta.layers) {
            if (meta.layers.dnl && Number.isFinite(meta.layers.dnl.offset) && Number.isFinite(meta.layers.dnl.step)) {
                const { offset, step } = meta.layers.dnl;
                LAYERS.dnl.decode = v => offset + v * step;
            }
            for (const key of ['traffic', 'above45']) {
                const lm = meta.layers[key];
                if (lm && lm.encoding && /log/i.test(lm.encoding)) {
                    const m = /([0-9.]+)/.exec(lm.encoding);
                    const scale = m && Number.isFinite(parseFloat(m[1])) && parseFloat(m[1]) > 1 ? parseFloat(m[1]) : 40;
                    LAYERS[key].decode = v => Math.pow(10, v / scale) - 1;
                }
            }
        }

        const date = (meta && meta.date) || (config && config.date);
        if (date) {
            $('subtitle').textContent = `Estimated from ADS-B data for ${date}`;
            $('aboutDate').textContent = date;
        }
        if (meta && meta.generatedAt) {
            const when = new Date(meta.generatedAt);
            $('aboutGenerated').textContent = `Tiles generated ${Number.isNaN(when.getTime()) ? meta.generatedAt : when.toLocaleString()}.`;
        }

        populateCities(config);

        // Restore min threshold from hash (units: dB for dnl, minutes for traffic)
        if (hash.min !== undefined) {
            if (state.layer === 'dnl') state.min.dnl = Math.min(80, Math.max(35, hash.min));
            else state.min[state.layer] = Math.max(0, hash.min) * 60;
        }

        // Controls
        document.querySelectorAll('.segmented button[data-layer]').forEach(b => {
            b.addEventListener('click', () => setLayer(b.dataset.layer));
        });
        $('minSlider').addEventListener('input', e => {
            const def = LAYERS[state.layer];
            state.min[state.layer] = def.sliderToValue(parseInt(e.target.value, 10));
            $('minValue').textContent = def.formatMin(state.min[state.layer]);
            applyStyle();
        });
        $('opacitySlider').value = Math.round(state.opacity * 100);
        $('opacityValue').textContent = `${Math.round(state.opacity * 100)}%`;
        $('opacitySlider').addEventListener('input', e => {
            state.opacity = parseInt(e.target.value, 10) / 100;
            $('opacityValue').textContent = `${Math.round(state.opacity * 100)}%`;
            applyStyle();
        });

        map.on('moveend zoomend', writeHash);
        map.on('mousemove', onHover);
        map.on('mouseout', () => { if (!state.pinned) updateReadout(null); });
        map.on('click', onTap);
        window.addEventListener('hashchange', () => {
            const h = readHash();
            if (!h) return;
            if (h.center) map.setView(h.center, h.zoom !== undefined ? h.zoom : map.getZoom());
            if (h.layer && h.layer !== state.layer) setLayer(h.layer, { silent: true });
        });

        setLayer(state.layer, { silent: true });
        writeHash();

        if (!meta) {
            setStatus('error', 'No tile metadata found');
            toast('Could not load data/tiles/meta.json. Run the tile renderer and build-site first.');
        } else {
            const zooms = Number.isFinite(meta.maxZoom) ? `zoom 0-${meta.maxZoom}` : '';
            setStatus('ok', ['Tiles ready', zooms].filter(Boolean).join(', '));
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        init().catch(err => {
            console.error(err);
            setStatus('error', 'Failed to start');
            toast(`Failed to start: ${err.message}`);
        });
    });
})();
