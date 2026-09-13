/* Flight paths viewer - loads per-city GeoJSON from data/flightpaths/. */
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
    const DATA_DIR = 'data/flightpaths/';
    const LINE_COLOR = '#2563eb';

    let map, renderer, geoLayer = null, config = null, entries = [], current = null;
    let opacity = 0.5;
    let loadToken = 0;

    // ---------------- naming ----------------

    /** "USA_CA_LosAngeles" -> "Los Angeles, CA, USA" (mirrors scripts/build-site.js). */
    function prettyName(key) {
        const parts = String(key).replace(/\.json$/i, '').split('_').filter(Boolean);
        // Strip trailing "<radius>_miles" if a filename was passed.
        if (parts.length >= 2 && /^miles?$/i.test(parts[parts.length - 1]) && /^\d+$/.test(parts[parts.length - 2])) parts.splice(-2, 2);
        if (!parts.length) return String(key);
        const city = parts[parts.length - 1].replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
        const prefixes = parts.slice(0, -1).reverse();
        return [city, ...prefixes].join(', ');
    }

    function radiusFromFile(file) {
        const m = /_(\d+)_miles?\.json$/i.exec(file);
        return m ? parseInt(m[1], 10) : null;
    }

    /** Normalise metadata.json (new or old shape) into [{file, name, radius, features}]. */
    function normaliseMetadata(meta) {
        let list = Array.isArray(meta) ? meta : (meta && Array.isArray(meta.files) ? meta.files : []);
        return list.map(item => {
            if (typeof item === 'string') {
                return { file: item, name: prettyName(item), radius: radiusFromFile(item), features: null };
            }
            const file = item.file || item.filename;
            if (!file) return null;
            const name = item.displayName || (item.city ? prettyName(item.city) : prettyName(file));
            const radius = Number.isFinite(item.radius) ? item.radius : radiusFromFile(file);
            const features = Number.isFinite(item.features) ? item.features : null;
            return { file, name, radius, features };
        }).filter(Boolean);
    }

    // ---------------- ui ----------------

    function setStatus(kind, text) {
        $('status').className = `status ${kind}`;
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

    function setPanelCollapsed(collapsed) {
        $('panel').classList.toggle('collapsed', collapsed);
        const btn = $('panelToggle');
        btn.textContent = collapsed ? 'Controls' : 'Hide';
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    function populateSelect() {
        const select = $('citySelect');
        select.innerHTML = '<option value="">Select a city...</option>';
        const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name) || (a.radius || 0) - (b.radius || 0));
        for (const e of sorted) {
            const opt = document.createElement('option');
            opt.value = e.file;
            const bits = [e.name];
            if (e.radius) bits.push(`${e.radius} mi`);
            if (e.features) bits.push(`${e.features.toLocaleString()} paths`);
            opt.textContent = bits.join(' - ');
            select.appendChild(opt);
        }
    }

    // ---------------- map readiness ----------------

    /**
     * Leaflet's canvas renderer sizes its <canvas> from the map container.
     * If the container has not been laid out yet (0 x 0), or the renderer
     * has not been attached, every path is drawn onto an empty canvas and
     * nothing appears until the next pan. Attach the renderer, then wait
     * (with a plain timer, since requestAnimationFrame is paused in
     * background tabs) until both the map and its canvas report a size.
     */
    function waitForCanvas() {
        return new Promise(resolve => {
            const started = Date.now();
            const check = () => {
                if (!map.hasLayer(renderer)) map.addLayer(renderer);
                const size = map.getSize();
                const el = renderer._container;
                if (size.x > 0 && size.y > 0 && el && el.width > 0 && el.height > 0) return resolve();
                if (Date.now() - started > 4000) {
                    console.warn('Map canvas never reported a size; drawing anyway');
                    return resolve();
                }
                if (size.x > 0 && size.y > 0) map.invalidateSize({ animate: false });
                setTimeout(check, 50);
            };
            map.whenReady(check);
        });
    }

    // ---------------- loading ----------------

    async function fetchWithProgress(url, onProgress) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = parseInt(res.headers.get('content-length') || '0', 10);
        if (!res.body || !res.body.getReader) return res.json();
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            onProgress(received, total);
        }
        const buf = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        return JSON.parse(new TextDecoder().decode(buf));
    }

    const mb = n => `${(n / 1048576).toFixed(1)} MB`;

    async function loadFlightPath(file) {
        const entry = entries.find(e => e.file === file) || { file, name: prettyName(file), radius: radiusFromFile(file) };
        const token = ++loadToken;
        clearMap({ keepSelect: true });
        setStatus('loading', `Loading ${entry.name}...`);
        $('clearBtn').disabled = false;

        try {
            const data = await fetchWithProgress(DATA_DIR + file, (got, total) => {
                if (token !== loadToken) return;
                setStatus('loading', total ? `Loading ${mb(got)} of ${mb(total)}` : `Loading ${mb(got)}`);
            });
            if (token !== loadToken) return;

            setStatus('loading', 'Drawing...');
            await waitForCanvas();
            if (token !== loadToken) return;

            const hasProps = Array.isArray(data.features) && data.features.some(f => f.properties && Object.keys(f.properties).length);
            geoLayer = L.geoJSON(data, {
                renderer,
                interactive: hasProps,
                smoothFactor: 1.5,
                style: { color: LINE_COLOR, weight: 1, opacity },
                onEachFeature: hasProps ? (feature, layer) => {
                    const p = feature.properties || {};
                    const rows = Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== '')
                        .map(([k, v]) => `<b>${escapeHtml(k)}</b>: ${escapeHtml(String(v))}`);
                    if (rows.length) layer.bindPopup(rows.join('<br>'));
                } : undefined
            }).addTo(map);

            const bounds = geoLayer.getBounds();
            if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });

            current = entry;
            const count = Array.isArray(data.features) ? data.features.length : 0;
            $('info').hidden = false;
            $('infoArea').textContent = entry.radius ? `${entry.name} (${entry.radius} mile radius)` : entry.name;
            $('infoCount').textContent = count.toLocaleString();
            $('infoDate').textContent = (config && config.date) || 'unknown';
            setStatus('ok', `${count.toLocaleString()} paths drawn`);
            location.hash = encodeURIComponent(file);
            if (window.matchMedia('(max-width: 640px)').matches) setPanelCollapsed(true);
        } catch (err) {
            if (token !== loadToken) return;
            console.error(err);
            setStatus('error', 'Failed to load');
            toast(`Failed to load ${file}: ${err.message}`);
        }
    }

    function escapeHtml(s) {
        return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function clearMap({ keepSelect } = {}) {
        if (geoLayer) { map.removeLayer(geoLayer); geoLayer = null; }
        current = null;
        $('info').hidden = true;
        if (!keepSelect) {
            $('citySelect').value = '';
            $('clearBtn').disabled = true;
            history.replaceState(null, '', location.pathname + location.search);
            setStatus('ok', `${entries.length} areas available`);
        }
    }

    // ---------------- boot ----------------

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
        return res.json();
    }

    async function init() {
        renderer = L.canvas({ padding: 0.5 });
        map = L.map('map', {
            center: [39.8, -98.6],
            zoom: 4,
            minZoom: 2,
            maxZoom: 16,
            zoomControl: false,
            preferCanvas: true,
            renderer,
            zoomSnap: 0.5,
            zoomDelta: 0.5
        });
        renderer.addTo(map);   // attach now so its canvas is sized with the map
        L.control.zoom({ position: 'topright' }).addTo(map);
        L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(map);
        L.tileLayer(BASEMAP.url, {
            maxZoom: 19,
            attribution: BASEMAP.attribution + ', data: <a href="https://www.adsbexchange.com/">ADS-B Exchange</a>'
        }).addTo(map);

        $('panelToggle').addEventListener('click', () => setPanelCollapsed(!$('panel').classList.contains('collapsed')));
        $('clearBtn').addEventListener('click', () => clearMap());
        $('citySelect').addEventListener('change', e => { if (e.target.value) loadFlightPath(e.target.value); });
        $('opacitySlider').value = Math.round(opacity * 100);
        $('opacitySlider').addEventListener('input', e => {
            opacity = parseInt(e.target.value, 10) / 100;
            $('opacityValue').textContent = `${Math.round(opacity * 100)}%`;
            if (geoLayer) geoLayer.setStyle({ opacity });
        });

        setStatus('loading', 'Loading list...');
        const [meta, cfg] = await Promise.all([
            fetchJson(DATA_DIR + 'metadata.json').catch(err => { console.warn(err); return null; }),
            fetchJson('data/config.json').catch(() => null)
        ]);
        config = cfg;
        if (cfg && cfg.date) $('subtitle').textContent = `ADS-B data for ${cfg.date}`;
        entries = normaliseMetadata(meta);
        populateSelect();

        if (!entries.length) {
            setStatus('error', 'No flight path files');
            toast('No flight paths found. Run the processor and build-site first.');
            return;
        }
        setStatus('ok', `${entries.length} areas available`);

        const loadFromHash = () => {
            const wanted = decodeURIComponent(location.hash.replace(/^#/, ''));
            if (!wanted || !entries.some(e => e.file === wanted)) return;
            if (current && current.file === wanted) return;
            $('citySelect').value = wanted;
            loadFlightPath(wanted);
        };
        window.addEventListener('hashchange', loadFromHash);
        loadFromHash();
    }

    window.addEventListener('DOMContentLoaded', () => {
        init().catch(err => {
            console.error(err);
            setStatus('error', 'Failed to start');
            toast(`Failed to start: ${err.message}`);
        });
    });
})();
