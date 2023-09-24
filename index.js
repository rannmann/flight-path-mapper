const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

//const SEATTLE_COORDINATES = {lat: 47.6097, lon: -122.3331};  // Seattle coordinates
const ANCHORAGE_AK_COORDINATES = {lat: 61.2181, lon: -149.9003};  // Anchorage, AK coordinates

const SEARCH_COORDINATES = ANCHORAGE_AK_COORDINATES;
let radii = [10, 20, 40, 60];  // Array of Radii in miles to generate multiple paths in one iteration.

// Object to hold flight paths
let flightPaths = {};

// Initialize flightPaths object for each radius
radii.forEach(radius => {
    flightPaths[radius] = {};
});

/**
 * Function to calculate distance between two geographical coordinates.
 *
 * @param lat1
 * @param lon1
 * @param lat2
 * @param lon2
 * @returns {number}
 */
function distance(lat1, lon1, lat2, lon2) {
    let R = 3958.8; // Radius of the earth in miles
    let φ1 = toRadians(lat1);
    let φ2 = toRadians(lat2);
    let Δφ = toRadians(lat2 - lat1);
    let Δλ = toRadians(lon2 - lon1);

    let a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Function to convert degrees to radians.
 *
 * @param degrees
 * @returns {number}
 */
function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

/**
 * Function to check if a geographical coordinate is within a given radius.
 *
 * @param lat
 * @param lon
 * @param radius
 * @returns {boolean}
 */
function isWithinRadius(lat, lon, radius) {
    return distance(SEARCH_COORDINATES.lat, SEARCH_COORDINATES.lon, lat, lon) <= radius;
}

/**
 * Processes a file and collects flight path points that match the search criteria.
 *
 * @param file
 * @returns {Promise<unknown>}
 */
async function processFile(file) {
    return new Promise((resolve, reject) => {
        const gunzip = zlib.createGunzip();
        const stream = fs.createReadStream(file).pipe(gunzip);

        let dataString = '';
        stream.on('data', chunk => {
            dataString += chunk.toString();
        });
        stream.on('end', () => {
            // Process file for each radius
            radii.forEach(radius => {
                const data = JSON.parse(dataString);
                data.aircraft
                    .filter(plane => isWithinRadius(plane.lat, plane.lon, radius))
                    .forEach(plane => {
                        if (!flightPaths[radius][plane.hex]) {
                            flightPaths[radius][plane.hex] = {
                                type: 'Feature',
                                geometry: {
                                    type: 'LineString',
                                    coordinates: []
                                }
                            };
                        }
                        flightPaths[radius][plane.hex].geometry.coordinates.push([plane.lon, plane.lat]);
                    });
            });
            resolve();
        });
        stream.on('error', reject);
    });
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    const directory = 'flight-history/2023-09-01';
    const files = fs.readdirSync(directory);
    for (const file of files) {
        try {
            await processFile(path.join(directory, file));
            console.log(`Processed ${file}`);
        } catch (error) {
            console.error(`Error processing ${file}: ${error}`);
        }
    }
    // Write one file for each radius
    radii.forEach(radius => {
        const outFile = `./flightPaths_${radius}_miles.json`;
        fs.writeFileSync(outFile, JSON.stringify({
            type: 'FeatureCollection',
            features: Object.values(flightPaths[radius]),
        }));
        console.log(`Flight paths for ${radius} miles radius written to ${outFile}`);
    });
}

main().catch(console.error);
