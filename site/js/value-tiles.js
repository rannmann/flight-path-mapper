/*
 * L.ValueTileLayer - draws greyscale "value tiles" produced by
 * scripts/render-tiles.js, colouring them in the browser.
 *
 * Tile contract
 *   data/tiles/<layer>/<z>/<mx>_<my>.png
 *   Metatiles pack M x M standard 256 px XYZ tiles (M = min(metaTileSize, 2^z)).
 *   mx = floor(x / M), my = floor(y / M); tile (x, y) sits at
 *   ((x mod M) * 256, (y mod M) * 256) inside the image.
 *   A 404 means "all empty". Pixel value (red channel) 0 = no data.
 *
 * Usage
 *   const layer = new L.ValueTileLayer({
 *       url: 'data/tiles/dnl',   // directory holding <z>/<mx>_<my>.png
 *       maxNativeZoom: 8,
 *       metaTileSize: 8,
 *       decode: v => 30 + v * 0.25,   // encoded value -> physical value
 *       palette: v => [r, g, b, a],   // physical value -> rgba (0..255)
 *       minValue: 45,                 // physical; cells below are hidden
 *       opacity: 0.8
 *   });
 *   layer.setStyle({ minValue: 55 });        // repaints without refetching
 *   layer.valueAt(latlng);                   // -> physical value or null
 */
(function (global) {
    'use strict';

    const L = global.L;
    if (!L) throw new Error('value-tiles.js requires Leaflet to be loaded first');

    const TILE = 256;
    const MAX_CACHED_METATILES = 12;   // ~4 MB each at full size

    function loadBitmap(blob) {
        if (global.createImageBitmap) {
            return global.createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
                .catch(() => global.createImageBitmap(blob));
        }
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
            img.src = url;
        });
    }

    const ValueTileLayer = L.GridLayer.extend({
        options: {
            url: 'data/tiles/dnl',
            tileSize: TILE,
            metaTileSize: 8,
            minNativeZoom: 0,
            maxNativeZoom: 8,
            maxZoom: 14,
            minValue: -Infinity,
            opacity: 0.8,
            decode: v => v,
            palette: () => [0, 0, 0, 255],
            className: 'value-tile-pane',
            updateWhenZooming: false,
            keepBuffer: 1
        },

        initialize(options) {
            L.Util.setOptions(this, options);
            this._metaCache = new Map();    // "z/mx/my" -> Promise<{size, values}|null>
            this._lut = null;
            this._minEncoded = 1;
            this._rebuildLut();
        },

        // ----- public API -------------------------------------------------

        /** Recolour every drawn tile without refetching. */
        setStyle(style) {
            style = style || {};
            let restyle = false;
            if (style.palette) { this.options.palette = style.palette; restyle = true; }
            if (style.decode) { this.options.decode = style.decode; restyle = true; }
            if (style.minValue !== undefined) { this.options.minValue = style.minValue; restyle = true; }
            if (style.opacity !== undefined) this.setOpacity(style.opacity);
            if (restyle) {
                this._rebuildLut();
                for (const key in this._tiles) {
                    const tile = this._tiles[key];
                    if (tile && tile.el && tile.el._values !== undefined) this._paint(tile.el);
                }
            }
            return this;
        },

        /** Physical value at a lat/lng, read from the drawn tile's stored values. */
        valueAt(latlng) {
            const raw = this.rawValueAt(latlng);
            return raw === null || raw === 0 ? null : this.options.decode(raw);
        },

        /** Encoded (0..255) value at a lat/lng, or null when no tile is drawn there. */
        rawValueAt(latlng) {
            if (!this._map || this._tileZoom === undefined) return null;
            const z = this._tileZoom;
            const p = this._map.project(latlng, z).floor();
            const coords = new L.Point(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
            coords.z = z;
            const wrapped = this._wrapCoords(coords);
            const tile = this._tiles[this._tileCoordsToKey(wrapped)];
            if (!tile || !tile.el || tile.el._values === undefined) return null;
            const values = tile.el._values;
            if (!values) return 0;
            const ix = ((p.x % TILE) + TILE) % TILE;
            const iy = ((p.y % TILE) + TILE) % TILE;
            return values[iy * TILE + ix];
        },

        /** Drop cached metatiles (e.g. after switching data sets). */
        clearCache() {
            this._metaCache.clear();
            return this;
        },

        // ----- Leaflet hooks ----------------------------------------------

        createTile(coords, done) {
            const canvas = document.createElement('canvas');
            canvas.width = TILE;
            canvas.height = TILE;
            canvas.className = 'value-tile';
            canvas.style.imageRendering = 'pixelated';

            const z = coords.z;
            const m = Math.min(this.options.metaTileSize, Math.pow(2, z));
            const mx = Math.floor(coords.x / m);
            const my = Math.floor(coords.y / m);
            const ox = (coords.x - mx * m) * TILE;
            const oy = (coords.y - my * m) * TILE;

            this._loadMeta(z, mx, my).then(meta => {
                if (!meta) {
                    canvas._values = null;               // known empty
                } else {
                    const values = new Uint8Array(TILE * TILE);
                    const size = meta.size;
                    const src = meta.values;
                    for (let row = 0; row < TILE; row++) {
                        const srcOff = (oy + row) * size + ox;
                        values.set(src.subarray(srcOff, srcOff + TILE), row * TILE);
                    }
                    canvas._values = values;
                }
                this._paint(canvas);
                done(null, canvas);
            }).catch(err => {
                canvas._values = null;
                done(err, canvas);
            });

            return canvas;
        },

        // ----- internals --------------------------------------------------

        _metaUrl(z, mx, my) {
            return `${this.options.url}/${z}/${mx}_${my}.png`;
        },

        _loadMeta(z, mx, my) {
            const key = `${z}/${mx}/${my}`;
            const cache = this._metaCache;
            if (cache.has(key)) {
                const p = cache.get(key);
                cache.delete(key);          // refresh LRU position
                cache.set(key, p);
                return p;
            }
            const promise = fetch(this._metaUrl(z, mx, my), { cache: 'force-cache' }).then(res => {
                if (res.status === 404) return null;
                if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`);
                return res.blob().then(loadBitmap).then(img => this._extract(img));
            });
            promise.catch(() => cache.delete(key));   // let a failed fetch be retried
            cache.set(key, promise);
            while (cache.size > MAX_CACHED_METATILES) {
                const oldest = cache.keys().next().value;
                cache.delete(oldest);
            }
            return promise;
        },

        /** Decode an image into a square Uint8Array of red-channel values. */
        _extract(img) {
            const w = img.width, h = img.height;
            const size = Math.max(w, h);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0);
            if (img.close) img.close();
            const rgba = ctx.getImageData(0, 0, size, size).data;
            const values = new Uint8Array(size * size);
            for (let i = 0, j = 0; i < values.length; i++, j += 4) values[i] = rgba[j];
            return { size, values };
        },

        _rebuildLut() {
            const lut = new Uint8ClampedArray(256 * 4);
            const decode = this.options.decode;
            const palette = this.options.palette;
            const min = this.options.minValue;
            let minEncoded = 256;
            for (let v = 1; v < 256; v++) {
                const phys = decode(v);
                if (!(phys >= min)) continue;
                if (v < minEncoded) minEncoded = v;
                const c = palette(phys) || [0, 0, 0, 0];
                lut[v * 4] = c[0];
                lut[v * 4 + 1] = c[1];
                lut[v * 4 + 2] = c[2];
                lut[v * 4 + 3] = c.length > 3 ? c[3] : 255;
            }
            this._lut = lut;
            this._minEncoded = minEncoded;
        },

        _paint(canvas) {
            const ctx = canvas.getContext('2d');
            const values = canvas._values;
            if (!values) {
                ctx.clearRect(0, 0, TILE, TILE);
                return;
            }
            const lut = this._lut;
            const minEnc = this._minEncoded;
            const image = ctx.createImageData(TILE, TILE);
            const out = image.data;
            let any = false;
            for (let i = 0, j = 0; i < values.length; i++, j += 4) {
                const v = values[i];
                if (v < minEnc) continue;      // 0 (no data) always < minEnc
                out[j] = lut[v * 4];
                out[j + 1] = lut[v * 4 + 1];
                out[j + 2] = lut[v * 4 + 2];
                out[j + 3] = lut[v * 4 + 3];
                any = true;
            }
            if (any) ctx.putImageData(image, 0, 0);
            else ctx.clearRect(0, 0, TILE, TILE);
        }
    });

    L.ValueTileLayer = ValueTileLayer;
    L.valueTileLayer = options => new ValueTileLayer(options);

    // Export for node-side tests of the pure helpers.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ValueTileLayer };
    }
})(typeof window !== 'undefined' ? window : globalThis);
