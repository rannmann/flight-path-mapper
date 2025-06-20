const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const {Worker, isMainThread, parentPort, workerData} = require('worker_threads');
const async = require('async');
const os = require('os');

// Reduces granularity of data by skipping every-other file.
// This means the result set will represent every 10s instead of every 5s.
// Speeds up data generation and reduces the output file size.
const LIGHTWEIGHT_MODE = false;

// Every city in here will have a flight path generated.
// The more you have, the more RAM it uses, so be careful.
const GENERATOR_COORDINATES = {
    'GBR_London': {lat: 51.5074, lon: -0.1278},
    'GBR_Manchester': {lat: 53.4808, lon: -2.2426},
    'USA_AZ_Phoenix': {lat: 33.4484, lon: -112.0740},
    'USA_CA_LosAngeles': {lat: 34.0522, lon: -118.2437},
    'USA_CO_Denver': {lat: 39.7392, lon: -104.9903},
    'USA_FL_Miami': {lat: 25.7617, lon: -80.1918},
    'USA_GA_Atlanta': {lat: 33.7490, lon: -84.3880},
    'USA_IL_Chicago': {lat: 41.8781, lon: -87.6298},
    'USA_MA_Boston': {lat: 42.3601, lon: -71.0589},
    'USA_MD_Baltimore': {lat: 39.2904, lon: -76.6122},
    'USA_TX_Dallas': {lat: 32.7767, lon: -96.7970},
    'USA_WA_Tacoma': {lat: 47.2529, lon: -122.4443},
};

// Array of Radii in miles to generate multiple paths in one iteration.
let radii = [20];

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
 * Returns an object with a boolean for each city.
 *
 * @param lat
 * @param lon
 * @param radius
 * @returns {{}}
 */
function isWithinRadius(lat, lon, radius) {
    let result = {};

    for (const city in GENERATOR_COORDINATES) {
        result[city] = distance(GENERATOR_COORDINATES[city].lat, GENERATOR_COORDINATES[city].lon, lat, lon) <= radius;
    }

    return result;
}

if (isMainThread) {
    async function main() {
        // JS multi-threading duplicates memory usage, so if this is too much, manually set it.
        const CONCURRENCY_LIMIT = Math.round(os.cpus().length / 2);
        const directory = 'flight-history/2023-09-01';
        const files = fs.readdirSync(directory);

        let flightPaths = {};

        for (const city in GENERATOR_COORDINATES) {
            flightPaths[city] = {};
            radii.forEach(radius => {
                flightPaths[city][radius] = {};
            });
        }

        let i = 0;
        async.eachLimit(files, CONCURRENCY_LIMIT, (file, done) => {
            if (LIGHTWEIGHT_MODE && i++ % 2 === 0) {
                console.log(`Skipping ${file}`);
                done();
                return;
            }
            processFile(path.join(directory, file))
                .then(result => {
                    for (const city in result) {
                        radii.forEach(radius => {
                            Object.keys(result[city][radius]).forEach(hex => {
                                if (!flightPaths[city][radius][hex]) {
                                    flightPaths[city][radius][hex] = result[city][radius][hex];
                                } else {
                                    flightPaths[city][radius][hex].geometry.coordinates.push(...result[city][radius][hex].geometry.coordinates);
                                }
                            });
                        });
                    }

                    console.log(`Processed ${file}`);
                    done();
                })
                .catch(error => {
                    console.error(`Error processing ${file}: ${error}`);
                    done();
                });
        }, err => {
            if (err) console.error(err);

            for (const city in flightPaths) {
                radii.forEach(radius => {
                    const outFile = `./flightpaths/${city}_${radius}_miles.json`;
                    fs.writeFileSync(outFile, JSON.stringify({
                        type: 'FeatureCollection',
                        features: Object.values(flightPaths[city][radius]),
                    }));
                    console.log(`Flight paths for ${city} at ${radius} miles radius written to ${outFile}`);
                });
            }
        });
    }

    main().catch(console.error);

} else {
    let dataString = '';
    let file = workerData;
    let flightPaths = {};

    for (const city in GENERATOR_COORDINATES) {
        flightPaths[city] = {};
        radii.forEach(radius => {
            flightPaths[city][radius] = {};
        });
    }

    const gunzip = zlib.createGunzip();
    const stream = fs.createReadStream(file).pipe(gunzip);

    stream.on('data', chunk => {
        dataString += chunk.toString();
    });

    stream.on('end', () => {
        // Process file for each radius
        radii.forEach(radius => {
            const data = JSON.parse(dataString);

            data.aircraft.forEach(plane => {
                let cityRadius = isWithinRadius(plane.lat, plane.lon, radius);

                for (const city in cityRadius) {
                    if (cityRadius[city]) {
                        if (!flightPaths[city]) flightPaths[city] = {};
                        if (!flightPaths[city][radius]) flightPaths[city][radius] = {};
                        if (!flightPaths[city][radius][plane.hex]) {
                            flightPaths[city][radius][plane.hex] = {
                                type: 'Feature',
                                geometry: { type: 'LineString', coordinates: [] }
                            };
                        }

                        flightPaths[city][radius][plane.hex].geometry.coordinates.push([plane.lon, plane.lat]);
                    }
                }
            });
        });

        parentPort.postMessage(flightPaths);
    });

    stream.on('error', err => {
        throw err;
    });
}

function processFile(file) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
            workerData: file
        });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        })
    });
}
