const fs = require('fs');
const path = require('path');

class Aircraft {
    /**
     * @param {number} middleLat Where the center of the grid begins.
     * @param {number} middleLon Where the center of the grid begins.
     */
    constructor(middleLat, middleLon) {
        this.aircraftsKeyedByType = {};
        this.middleLat = middleLat;
        this.middleLon = middleLon;
        this.init();
    }

    init() {
        const filename = path.resolve(__dirname, 'aircraftsKeyedByType.json');

        // Check if the file already exists
        if (fs.existsSync(filename)) {
            // load the data from the file
            this.aircraftsKeyedByType = require(filename);

            //console.log('Loaded aircraft types from file');
            return;
        }

        // If file doesn't exist, generate data from airplanes.json
        let aircraftsData = require('./airplanes.json');

        // Key aircraft data by type, dropping data we don't need.
        aircraftsData.forEach(aircraft => {
            if (!aircraft.engines_type) {
                // If we don't have an engine type, we can't use this data.
                return;
            }

            if (aircraft.iata_code_long in this.aircraftsKeyedByType) {
                // We've already seen this type, so we don't need to store it again.
                return;
            }

            this.aircraftsKeyedByType[aircraft.iata_code_long] = {
                //engines_count: aircraft.engines_count,
                engines_type: aircraft.engines_type,
                //plane_age: aircraft.plane_age,
            };
        });

        // Save the generated data to a file
        fs.writeFileSync(filename, JSON.stringify(this.aircraftsKeyedByType));

        console.log(`Loaded ${Object.keys(this.aircraftsKeyedByType).length} aircraft types`);
    }

    getAircraftDataByType(type) {
        return this.aircraftsKeyedByType[type] || null;
    }

    /**
     * Calculates the loudness of a plane based on its speed, altitude, and climb rate.
     *
     * @param plane
     * @returns {number|number|null}
     */
    calculateLoudness(plane) {
        let speed = plane.gs;
        let altitude = plane.alt_baro;
        let geom_rate = plane.geom_rate;

        if (altitude === 'ground') {
            // If the plane is on the ground, we don't need to calculate loudness.
            // This is mostly to clear up garbage data of planes sitting on the ground.
            // It also helps to reduce airport noise skew.
            return null;
        }

        let fullEffectAltitude = 1000; // altitude where plane is at maximum loudness
        let maxSpeed = 575;
        let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;
        let speedFactor = (1 - speed / maxSpeed);

        let sizeFactor = this.getSizeFactor(plane) ?? 1;

        let climbFactor = geom_rate > 0 ? 1.1 : 1;
        let maxLoudness = 120 * sizeFactor;

        let loudness = maxLoudness * speedFactor * attenuation * climbFactor;

        return loudness < 0 ? 0 : Math.min(120, loudness); // making sure loudness is within [0, 120]
    }

    calculateSoundRadius(plane) {
        let altitude = plane.alt_baro;

        let fullEffectAltitude = 1000; // altitude where plane noise has the maximum radius
        let attenuation = altitude > fullEffectAltitude ? Math.exp(-(altitude - fullEffectAltitude) / 5000) : 1;

        // Multiplier for size of plane. Small planes are reduced, large planes are increased.
        let sizeFactor = this.getSizeFactor(plane) ?? 1;

        let maxRadius = 10 * sizeFactor;
        let radius = maxRadius * attenuation;

        return radius < 0 ? 0 : radius;
    }

    getSizeFactor(plane) {
        // If there is no category or type, we can't calculate the size.
        if (!plane.category && !plane.t) {
            // Don't record stats on this since it's not our data that is missing.
            //console.log(plane);
            return null;
        }

        // Try category first
        let sizeFactor = this.getSizeFactorByCategory(plane.category);

        if (sizeFactor) {
            return sizeFactor;
        }

        // If we can't find it by category, try to look it up by type
        let aircraftData = this.getSizeFactoryByPlaneData(plane);

        if (aircraftData) {
            return aircraftData;
        }

        return null;
    }

    // Rather than fetching aircraft data based on the model name, the easiest way is
    // to check the size of the aircraft based on reported transponder.
    // https://www.adsbexchange.com/emitter-category-ads-b-do-260b-2-2-3-2-5-2/
    getSizeFactorByCategory(aircraftCategory) {
        
        switch (aircraftCategory) {
            // Light
            case 'A1':
                return 0.8;

            // Small
            case 'A2':
                return 1;

            // Large
            case 'A3':
                return 1.1;

            // Boeing 757
            case 'A4':
            // Heavy
            case 'A5':
                return 1.2;

            // > 5Gs
            case 'A6':
            // Helicopters
            case 'A7':
                return 1.4;

            // Gliders
            case 'B1':
            // Lighter than air
            case 'B2':
            // Parachutists
            case 'B3':
                return 0;

            // Ultralights
            case 'B4':
                return 0.1;

            // UAV
            case 'B6':
                return 1;

            // Spacecraft
            case 'B7':
                return 1.6;

            // Obstacles. Not sure why these would be reported.
            case 'C1':
            case 'C2':
            case 'C3':
            case 'C4':
            case 'C5':
                return 0;

            // Unknown
            default:
                return null;
        }
    }

    getSizeFactoryByPlaneData(plane) {
        let aircraftData = this.getAircraftDataByType(plane.t);
        if (!aircraftData) {
            return null;
        }

        if (aircraftData.engines_type === 'JET') {
            return 1.2;
        }

        // We can't make many assumptions about remaining aircraft, so we'll just
        // assume turboprops are small planes but not as small as a light aircraft.
        return 1;
    }

    addLoudnessToGrid(plane, grid) {
        if (!plane.lat || !plane.lon) {
            // No location data, nothing to graph.
            return;
        }

        let loudness = this.calculateLoudness(plane);

        if (!loudness) {
            // No loudness, nothing to graph.
            return;
        }

        let loudnessRadius = this.calculateSoundRadius(plane);
        let soundArea = Math.PI * loudnessRadius * loudnessRadius; // This might need fine-tuning based on the actual implementation of calculateSoundRadius().
        let loudnessPerSquareKm = loudness / soundArea; // The loudness distributed over the area where the sound reaches.

        let gridPos = this.findContainingGridSquare(plane);
        let key = `${gridPos.y}_${gridPos.x}`;
        grid[key] = {
            totalLoudness: (grid[key] ? grid[key].totalLoudness : 0) + loudnessPerSquareKm,
            centralLon: gridPos.centralLon,
            centralLat: gridPos.centralLat
        };
    }

    findContainingGridSquare(plane) {
        const earthCircumference = 40075; // Earth's circumference at equator in km
        const latitudeDistPerDeg = earthCircumference / 360;
        const longitudeDistPerDeg = Math.cos(this.degreesToRadians(this.middleLat)) * earthCircumference / 360;  // computed at Seattle's latitude

        let xIndex = Math.floor((plane.lon - this.middleLon) * longitudeDistPerDeg);
        let yIndex = Math.floor((plane.lat - this.middleLat) * latitudeDistPerDeg);

        // grid central coordinates for each 1km square grid
        let centralLon = this.middleLon + (xIndex + 0.5) / longitudeDistPerDeg;
        let centralLat = this.middleLat + (yIndex + 0.5) / latitudeDistPerDeg;

        return {
            x: xIndex,
            y: yIndex,
            centralLon: centralLon,
            centralLat: centralLat
        };
    }

    convertGridBackToDegrees(grid) {
        let heatmapData = [];

        for (let key in grid) {
            let gridValue = grid[key];
            heatmapData.push([gridValue.centralLat, gridValue.centralLon, gridValue.totalLoudness]);
        }

        return heatmapData;
    }

    degreesToRadians(degrees) {
        return degrees * Math.PI / 180;
    }
}

module.exports = Aircraft;
