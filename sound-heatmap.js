const asyncLib = require('async');
const fs = require('fs');
const zlib = require("zlib");
const {Worker, isMainThread, parentPort, workerData} = require('worker_threads');
const AircraftLib = require('./lib/aircraft');
const Geo = require('./lib/geo');
const path = require("path");
const os = require("os");

const GENERATOR_COORDINATES = {
    'USA_WA_Seattle': {lat: 47.6062, lon: -122.3321},
};
const RADIUS_IN_MILES = 100;

if (isMainThread) {
    // Main thread
    const run = async () => {
        const CONCURRENCY_LIMIT = Math.round(os.cpus().length / 1.8);
        const directory = 'flight-history/2023-09-01';
        const filesInDir = fs.readdirSync(directory);
        //const targetFiles = filesInDir.slice(0, 600);

        let workerDataList = [];

        await new Promise((resolve, reject) => {
            asyncLib.eachLimit(filesInDir, CONCURRENCY_LIMIT, (file, cb) => {
                new Worker(__filename, {workerData: path.join(directory, file)})
                    .on('message', workerData => workerDataList.push(workerData))
                    .on('exit', () => cb())
                    .on('error', err => cb(err));
            }, (err) => {
                if (!err) resolve();
                else reject(err);
            });
        });

        const allWorkerResults = workerDataList;

        const aircraft = new AircraftLib(
            GENERATOR_COORDINATES.USA_WA_Seattle.lat,
            GENERATOR_COORDINATES.USA_WA_Seattle.lon
        );

        let grid = {};

        // The grid being returned is only for 1 file.
        // We need to add all the grids together to get the final grid.
        allWorkerResults.forEach(workerGrid => {
            for (let key in workerGrid) {
                if (grid[key]) {
                    // Combining the total loudness
                    grid[key].totalLoudness += workerGrid[key].totalLoudness;
                } else {
                    // Making sure we are adding valid entries into the grid only
                    if (workerGrid[key] && workerGrid[key].centralLat != null && workerGrid[key].centralLon != null) {
                        grid[key] = workerGrid[key];
                    }
                }
            }
        });

        try {
            // Write grid to file
            fs.writeFile('heatmap-grid.json', JSON.stringify(aircraft.convertGridBackToDegrees(grid)), (err) => {
                if (err) {
                    console.error(err);
                } else {
                    console.log("The file was saved!");
                }
            });
        } catch (err) {
            console.error(err);
        }
    };

    run().catch(console.error);
} else {
    // Worker
    const processFile = async fileName => {
        const gunzip = zlib.createGunzip();
        const fileContent = fs.createReadStream(fileName).pipe(gunzip);
        let dataString = '';
        for await (const chunk of fileContent) {
            dataString += chunk.toString();
        }
        const planes = JSON.parse(dataString).aircraft;

        const aircraft = new AircraftLib(
            GENERATOR_COORDINATES.USA_WA_Seattle.lat,
            GENERATOR_COORDINATES.USA_WA_Seattle.lon
        );

        // Make a new grid
        let grid = {};

        // Process planes and generate grid
        planes.forEach(plane => {
            if (Geo.distanceInMiles(plane.lat, plane.lon, 47.6062, -122.3321) < RADIUS_IN_MILES) {
                aircraft.addLoudnessToGrid(plane, grid);
            }
        });

        // Return it for this file to be added to the main grid
        return grid;
    };

    processFile(workerData).then((resultGrid) => {
        parentPort.postMessage(resultGrid);
    }).catch((error) => console.error(error));
}