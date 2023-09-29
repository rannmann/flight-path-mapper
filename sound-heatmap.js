const AircraftLib = require('./lib/aircraft');
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const Geo = require('./lib/geo');

const GENERATOR_COORDINATES = {
    'USA_WA_Seattle': {lat: 47.6062, lon: -122.3321},
};

const RADIUS_IN_MILES = 50;

// Our grid
let grid = {};

// Our aircraft library
const aircraft = new AircraftLib(
    GENERATOR_COORDINATES.USA_WA_Seattle.lat,
    GENERATOR_COORDINATES.USA_WA_Seattle.lon
);

// Function to process all planes
function processPlanes(planes) {
    planes.forEach(plane => {
        if (Geo.distanceInMiles(plane.lat, plane.lon, 47.6062, -122.3321) < RADIUS_IN_MILES) {
            aircraft.addLoudnessToGrid(plane, grid);
        }
    });
}


// Todo: for now, just read the first 200 files
async function processDataInFiles() {
    const directory = 'flight-history/2023-09-01';

    const filesInDir = fs.readdirSync(directory);
    const targetFiles = filesInDir.slice(0, 200);

    for (const file of targetFiles) {
        let dataString = '';
        const gunzip = zlib.createGunzip();
        const stream = fs.createReadStream(path.join(directory, file)).pipe(gunzip);

        for await (const chunk of stream) {
            dataString += chunk.toString();
        }

        try {
            const data = JSON.parse(dataString);
            processPlanes(data.aircraft);
        } catch (err) {
            console.error(`Failed to parse file ${file}:`, err);
        }
    }
}

async function main() {
    await processDataInFiles().catch((err) => console.error(err));

    // Write grid to file
    fs.writeFile('heatmap-grid.json', JSON.stringify(aircraft.convertGridBackToDegrees(grid)), function(err) {
        if(err) {
            return console.log(err);
        }
        console.log("The file was saved!");
    });
}

main();
