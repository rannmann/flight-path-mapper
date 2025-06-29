const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const config = require('./config');
const logger = require('./lib/logger');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    try {
        const requestedUrl = url.parse(req.url);
        const pathname = requestedUrl.pathname === '/' ? '/index.html' : requestedUrl.pathname;
        const ext = path.parse(pathname).ext;
        
        // Add CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const contentType = MIME_TYPES[ext] || 'text/plain';

        // API endpoints
        if (pathname === '/listflightpaths') {
            handleFlightPathsList(res);
        } else if (pathname === '/listheatmaps') {
            handleHeatmapsList(res);
        } else if (pathname === '/api/config') {
            handleConfigEndpoint(res);
        } else if (pathname === '/api/status') {
            handleStatusEndpoint(res);
        } else if (pathname.startsWith('/data/')) {
            // Serve data files (heatmaps, etc.)
            handleDataFile(pathname, contentType, res);
        } else {
            // Static file serving
            handleStaticFile(pathname, contentType, res);
        }
    } catch (error) {
        logger.error('Server error', { error: error.message, stack: error.stack });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
});

function handleFlightPathsList(res) {
    const flightPathsDir = path.join(__dirname, config.paths.flightPaths);
    
    fs.readdir(flightPathsDir, (err, files) => {
        if (err) {
            logger.warn('Failed to read flightpaths directory', { error: err.message });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
            return;
        }
        
        // Filter only JSON files
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(jsonFiles));
        logger.debug('Listed flight paths', { count: jsonFiles.length });
    });
}

function handleHeatmapsList(res) {
    const heatmapsDir = path.join(__dirname, 'data', 'heatmaps');
    
    fs.readdir(heatmapsDir, (err, files) => {
        if (err) {
            logger.warn('Failed to read heatmaps directory', { error: err.message });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
            return;
        }
        
        // Filter only heatmap JSON files (not metadata)
        const heatmapFiles = files.filter(file => file.endsWith('_heatmap.json'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(heatmapFiles));
        logger.debug('Listed heatmaps', { count: heatmapFiles.length });
    });
}

function handleConfigEndpoint(res) {
    const clientConfig = {
        cities: Object.keys(config.cities),
        defaultRadii: config.defaultRadii,
        defaultDate: config.defaultDate
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(clientConfig));
}

function handleStatusEndpoint(res) {
    const status = {
        server: 'running',
        timestamp: new Date().toISOString(),
        flightPathsCount: 0,
        dataDirectoryExists: fs.existsSync(path.join(__dirname, config.paths.flightHistory)),
        heatmapDataExists: fs.existsSync(path.join(__dirname, 'data', 'heatmaps', 'heatmap-grid.json'))
    };

    // Count flight path files
    try {
        const files = fs.readdirSync(path.join(__dirname, config.paths.flightPaths));
        status.flightPathsCount = files.filter(f => f.endsWith('.json')).length;
    } catch (err) {
        status.flightPathsCount = 0;
    }

    // Get heatmap metadata if available
    try {
        const metadataPath = path.join(__dirname, 'data', 'heatmaps', 'metadata.json');
        if (fs.existsSync(metadataPath)) {
            status.heatmapMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        }
    } catch (err) {
        // Ignore metadata errors
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
}

function handleDataFile(pathname, contentType, res) {
    const filePath = path.join(__dirname, pathname);
    
    // Security: ensure the path is within the data directory
    const dataDir = path.join(__dirname, 'data');
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(dataDir)) {
        logger.warn('Attempted access outside data directory', { pathname, resolvedPath });
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Access denied');
        return;
    }
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            logger.warn('Data file not found', { path: pathname });
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Data file not found' }));
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
            logger.debug('Served data file', { path: pathname, size: data.length });
        }
    });
}

function handleStaticFile(pathname, contentType, res) {
    const filePath = path.join(__dirname, pathname);
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            logger.warn('File not found', { path: pathname });
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                    <head><title>404 - Not Found</title></head>
                    <body>
                        <h1>404 - File Not Found</h1>
                        <p>The requested file <code>${pathname}</code> was not found.</p>
                        <a href="/">Return to home</a>
                    </body>
                </html>
            `);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
            logger.debug('Served file', { path: pathname, size: data.length });
        }
    });
}

server.listen(config.server.port, config.server.host, () => {
    logger.info(`Flight Path Mapper server started`, { 
        host: config.server.host, 
        port: config.server.port,
        url: `http://${config.server.host}:${config.server.port}`
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});
