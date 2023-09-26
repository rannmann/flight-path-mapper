const {calculateLoudness, calculateRadius, addLoudnessToGrid} = require('./lib/aircraft');
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
});

// WIP notes:
// It looks like some planes may be included in the dataset without
// a "category", which we use to calculate loudness.  We can fallback to our aircraft list.

// Here is an example:
// {"hex":"c00158","type":"adsb_icao","flight":"ANT570  ","r":"C-FANF","t":"B735","alt_baro":36000,"alt_geom":37300,"gs":332.8,"track":332.43,"baro_rate":64,"squawk":"2641","emergency":"none","category":"A0","nav_altitude_mcp":36000,"nav_heading":322.03,"lat":53.270920,"lon":-126.766453,"nic":8,"rc":186,"seen_pos":1.238,"version":2,"nic_baro":1,"nac_p":10,"nac_v":1,"sil":3,"sil_type":"perhour","gva":2,"sda":0,"alert":0,"spi":0,"mlat":[],"tisb":[],"messages":8765045,"seen":1.2,"rssi":-22.1}
// B735
// This exact plane is in our airplanes list, and from that we know it's a Boeing 737-55D.