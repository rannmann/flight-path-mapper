/**
 * Static file server for the built site (config.paths.site, normally docs/).
 * This is a local preview of what GitHub Pages serves; there is no API
 * beyond /api/status.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./lib/logger');

const SITE_ROOT = path.resolve(__dirname, config.paths.site);
const META_FILE = path.join(SITE_ROOT, 'data', 'tiles', 'meta.json');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': MIME_TYPES['.json'] });
    res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
    res.writeHead(status, { 'Content-Type': MIME_TYPES['.txt'] });
    res.end(text);
}

/** Resolve a URL path to a file inside SITE_ROOT, or null if it escapes. */
function resolveSitePath(pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch (err) {
        return null;
    }
    if (decoded.includes('\0')) return null;
    const resolved = path.resolve(SITE_ROOT, '.' + path.posix.normalize('/' + decoded));
    if (resolved !== SITE_ROOT && !resolved.startsWith(SITE_ROOT + path.sep)) return null;
    return resolved;
}

function handleStatus(res) {
    const status = {
        server: 'running',
        timestamp: new Date().toISOString(),
        siteRoot: SITE_ROOT,
        siteExists: fs.existsSync(SITE_ROOT),
        metaExists: fs.existsSync(META_FILE),
        meta: null
    };
    if (status.metaExists) {
        try {
            status.meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
        } catch (err) {
            status.metaError = err.message;
        }
    }
    sendJson(res, 200, status);
}

function handleStatic(pathname, res) {
    if (!fs.existsSync(SITE_ROOT)) {
        sendText(res, 503, `Site directory ${config.paths.site}/ does not exist yet. Run "npm run build" first.\n`);
        return;
    }
    let filePath = resolveSitePath(pathname);
    if (!filePath) {
        logger.warn('Rejected path outside site root', { pathname });
        sendText(res, 403, 'Forbidden\n');
        return;
    }
    try {
        if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch (err) {
        // fall through to readFile, which reports 404
    }
    fs.readFile(filePath, (err, data) => {
        if (err) {
            sendText(res, 404, `Not found: ${pathname}\n`);
            return;
        }
        const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendText(res, 405, 'Method not allowed\n');
            return;
        }
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/api/status') handleStatus(res);
        else handleStatic(pathname, res);
    } catch (err) {
        logger.error('Server error', { error: err.message });
        sendJson(res, 500, { error: 'Internal server error' });
    }
});

if (require.main === module) {
    server.listen(config.server.port, config.server.host, () => {
        logger.info('Static server started', {
            url: `http://${config.server.host}:${config.server.port}`,
            root: SITE_ROOT
        });
        if (!fs.existsSync(SITE_ROOT)) {
            logger.warn(`${config.paths.site}/ does not exist yet; run "npm run build" to generate it`);
        }
    });

    const shutdown = (signal) => {
        logger.info(`Received ${signal}, shutting down`);
        server.close(() => process.exit(0));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { server, resolveSitePath, MIME_TYPES };
