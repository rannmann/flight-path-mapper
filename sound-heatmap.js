const {calculateLoudness, calculateRadius, addLoudnessToGrid, outputMatches} = require('./lib/aircraft');
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

// Our grid
let grid = {};

// Function to process all planes
function processPlanes(planes) {
    planes.forEach(plane => {
        //console.log(plane);
        addLoudnessToGrid(plane, grid);
    });
}

const directory = 'flight-history/2023-09-01';
const files = fs.readdirSync(directory);
const gunzip = zlib.createGunzip();

let dataString = '';

// Todo: for now, just read the first file and load it into
const stream = fs.createReadStream(path.join(directory, files[0])).pipe(gunzip);
stream.on('data', chunk => {
    dataString += chunk.toString();
});
stream.on('end', () => {
    const data = JSON.parse(dataString);
    processPlanes(data.aircraft);
    outputMatches();
});
