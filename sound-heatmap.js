const {addLoudnessToGrid, convertGridBackToDegrees, debugOutput} = require('./lib/aircraft');
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const Geo = require('./lib/geo');

// Every city in here will have a flight path generated.
// The more you have, the more RAM it uses, so be careful.
const GENERATOR_COORDINATES = {
    'USA_WA_Seattle': {lat: 47.6062, lon: -122.3321},
};

// Array of Radii in miles to generate multiple paths in one iteration.
let radii = [50];

// Our grid
let grid = {};

// Function to process all planes
function processPlanes(planes) {
    planes.forEach(plane => {
        if (Geo.distanceInMiles(plane.lat, plane.lon, 47.6062, -122.3321) < 20) {
            addLoudnessToGrid(plane, grid);
        }
    });
}


// Todo: for now, just read the first 500 files
async function processDataInFiles() {
    const directory = 'flight-history/2023-09-01';

    const filesInDir = fs.readdirSync(directory);
    const targetFiles = filesInDir.slice(0, 500);

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
    fs.writeFile('heatmap-grid.json', JSON.stringify(convertGridBackToDegrees(grid)), function(err) {
        if(err) {
            return console.log(err);
        }
        console.log("The file was saved!");
    });
}

main();


// WIP notes:
// It looks like some planes may be included in the dataset without
// a "category", which we use to calculate loudness.  We can fallback to our aircraft list.

// Here is an example:
// {"hex":"c00158","type":"adsb_icao","flight":"ANT570  ","r":"C-FANF","t":"B735","alt_baro":36000,"alt_geom":37300,"gs":332.8,"track":332.43,"baro_rate":64,"squawk":"2641","emergency":"none","category":"A0","nav_altitude_mcp":36000,"nav_heading":322.03,"lat":53.270920,"lon":-126.766453,"nic":8,"rc":186,"seen_pos":1.238,"version":2,"nic_baro":1,"nac_p":10,"nac_v":1,"sil":3,"sil_type":"perhour","gva":2,"sda":0,"alert":0,"spi":0,"mlat":[],"tisb":[],"messages":8765045,"seen":1.2,"rssi":-22.1}
// B735
// This exact plane is in our airplanes list, and from that we know it's a Boeing 737-55D.