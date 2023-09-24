const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const PORT = 3000;  // Change to your preferred port number

const server = http.createServer((req, res) => {
    let requestedUrl = url.parse(req.url);
    let pathname = requestedUrl.pathname === '/' ? '/index.html' : requestedUrl.pathname;
    let ext = path.parse(pathname).ext;

    let contentType;
    switch (ext) {
        case '.html':
            contentType = 'text/html';
            break;
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        default:
            contentType = 'text/plain';
    }

    if(pathname === '/listflightpaths') {
        fs.readdir(path.join(__dirname, 'flightpaths'), (err, files) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(files));
        });
    } else {
        const filePath = path.join(__dirname, pathname);
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Not found');
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            }
        });
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
