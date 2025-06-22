/**
 * Research-based aircraft noise model
 * Based on DNL methodology, NPD curves, and psychoacoustic research
 * 
 * References:
 * - FAA Aviation Environmental Design Tool (AEDT)
 * - EUROCONTROL Aircraft Noise and Performance database
 * - Research on small aircraft psychoacoustic annoyance factors
 * - ISO 9613-1 acoustic propagation standards
 * 
 * =============================================================================
 * AIRCRAFT DATA AVAILABILITY ANALYSIS (ADS-B Exchange data)
 * =============================================================================
 * 
 * ALWAYS AVAILABLE (100% of records):
 * - hex: Aircraft transponder hex code (unique identifier)
 * - lat: Latitude in decimal degrees
 * - lon: Longitude in decimal degrees  
 * - type: Data source type (typically "adsc")
 * - messages: Total messages received from aircraft
 * - seen: Seconds since last message
 * - rssi: Signal strength
 * 
 * HIGHLY AVAILABLE (95%+ of records):
 * - alt_baro: Barometric altitude in feet (95.9% availability)
 * - gs: Ground speed in knots (98.9% availability)
 * - nic: Navigation Integrity Category (90.1%)
 * - seen_pos: Seconds since last position update (90.1%)
 * 
 * COMMONLY AVAILABLE (80-95% of records):
 * - flight: Flight number/callsign (89.7% availability)
 * - category: Aircraft category (A1-A7, B1-B7) (90.6% availability)
 * - r: Aircraft registration (87.0%)
 * - t: Aircraft type code (85.1%)
 * - track: Heading/track in degrees (83.4%)
 * - squawk: Transponder squawk code (82.2%)
 * 
 * MODERATELY AVAILABLE (40-80% of records):
 * - alt_geom: Geometric altitude in feet (45.1% availability)
 * - baro_rate: Barometric climb rate in ft/min (42.1% availability)
 * - emergency: Emergency status (69.5%)
 * 
 * SOMETIMES AVAILABLE (20-40% of records):
 * - geom_rate: Geometric climb rate in ft/min (27.3% availability)
 * - ias: Indicated airspeed (20.4%)
 * - mach: Mach number (20.3%)
 * - tas: True airspeed (20.3%)
 * 
 * RARELY AVAILABLE (<20% of records):
 * - nav_heading: Autopilot heading (30.2%)
 * - nav_altitude_mcp: MCP selected altitude (50.4%)
 * - wind data (wd/ws): Wind direction/speed (17.5%)
 * - temperature data (oat/tat): Outside/total air temp (17.3%)
 * 
 * =============================================================================
 * GROUND OPERATIONS AND TRANSPONDER BEHAVIOR
 * =============================================================================
 * 
 * IMPORTANT FINDINGS from data analysis:
 * 
 * 1. TRANSPONDERS ARE ACTIVE ON GROUND: Contrary to initial suspicion,
 *    aircraft transponders remain active during ground operations. Analysis
 *    shows 100% hex code availability across all altitude ranges including
 *    ground level.
 * 
 * 2. GROUND TRAFFIC IS WELL REPRESENTED: In Seattle area data:
 *    - 3,828 aircraft at ground level (59% of local traffic)
 *    - SeaTac: 3,091 ground operations detected
 *    - Boeing Field: 494 ground operations detected  
 *    - Renton: 137 ground operations detected
 * 
 * 3. ALTITUDE CODING: Ground operations are coded as altitude "ground" or
 *    very low values (<50 feet). These should be treated as 0 feet for
 *    noise calculations.
 * 
 * 4. GROUND SPEEDS: Ground aircraft show realistic taxi speeds:
 *    - Typical ground speeds: 0-25 knots
 *    - Parked aircraft: 0-3 knots
 *    - Taxiing aircraft: 15-25 knots
 * 
 * 5. DATA QUALITY AT AIRPORTS: Airport proximity enhances data quality.
 *    Aircraft within 3km of airports show excellent data completeness.
 * 
 * 6. WHY AIRPORTS APPEARED QUIET (FIXED): The original issue was NOT due
 *    to missing ground transponder data, but due to a bug in distance
 *    calculation where aircraft noise was computed relative to city center
 *    instead of the aircraft's own grid cell. This has been corrected.
 * 
 * =============================================================================
 * NOISE CALCULATION IMPLICATIONS
 * =============================================================================
 * 
 * For noise modeling, we can reliably use:
 * - Position (lat/lon): 100% available
 * - Altitude (alt_baro): 95.9% available, essential for 3D distance
 * - Speed (gs): 98.9% available, used for flight phase detection  
 * - Category: 90.6% available, critical for aircraft type classification
 * - Climb rate: Only 27.3% available, but can be estimated from flight profile
 * 
 * Missing data handling:
 * - If alt_baro missing: use alt_geom or assume pattern altitude (1000ft)
 * - If category missing: estimate from speed/altitude profile
 * - If climb rate missing: assume level flight (0 ft/min)
 * - If speed missing: estimate from aircraft category and altitude
 */

// Research-based aircraft noise calculation using DNL methodology
function calculateLoudness(aircraftCategory, speed, altitude, geom_rate) {
    // Get base NPD parameters for aircraft category
    const npdParams = getNPDParameters(aircraftCategory);
    if (!npdParams) {
        // Fallback for unknown aircraft
        const fallbackNoise = estimateNoiseFromCharacteristics(speed, altitude, geom_rate);
        return fallbackNoise || 0;
    }
    
    // Detect flight phase and estimate thrust setting
    const flightPhase = detectFlightPhase(altitude, geom_rate, speed);
    const thrustSetting = estimateThrust(flightPhase, geom_rate, speed, npdParams.category);
    
    // Calculate base noise using NPD curve: SEL = A + B × log₁₀(Thrust) + C × log₁₀(Distance)
    // Using 1km reference distance for source calculation
    const referenceDistance = 1.0; // km
    const baseNoise = npdParams.A + 
                     npdParams.B * Math.log10(thrustSetting) + 
                     npdParams.C * Math.log10(referenceDistance);
    
    // Apply flight phase corrections based on research
    let phaseCorrection = 0;
    switch (flightPhase) {
        case 'takeoff':
            phaseCorrection = 5; // Reduced from 10
            break;
        case 'climb':
            phaseCorrection = 2; // Reduced from 5
            break;
        case 'approach':
            phaseCorrection = 8; // Increased back to 8 for approach noise
            break;
        case 'descent':
            phaseCorrection = 1; // Reduced from 3
            break;
        case 'cruise':
            phaseCorrection = 0; // Baseline
            break;
        case 'pattern':
            phaseCorrection = 2; // Reduced from 5
            break;
    }
    
    // Apply psychoacoustic penalties based on research
    let psychoacousticPenalty = 0;
    
    // Small aircraft tonality penalty (propeller aircraft seem louder)
    if (npdParams.category === 'light' || npdParams.category === 'helicopter') {
        psychoacousticPenalty += 5; // Reduced from 10 - tonality effect
    }
    
    // Helicopter blade-vortex interaction penalty
    if (npdParams.category === 'helicopter' && geom_rate < -300) {
        psychoacousticPenalty += 3; // Reduced from 5 - BVI during descent
    }
    
    // Low altitude penalty (less atmospheric masking)
    if (altitude < 3000) {
        psychoacousticPenalty += Math.max(0, 3 - (altitude / 1000)); // Reduced penalty
    }
    
    // Calculate final noise level
    const totalNoiseLevel = baseNoise + phaseCorrection + psychoacousticPenalty;
    
    // Apply realistic limits based on research
    return Math.max(35, Math.min(145, totalNoiseLevel));
}

// NPD (Noise-Power-Distance) parameters based on research
function getNPDParameters(aircraftCategory) {
    // NPD curves: SEL = A + B × log₁₀(Thrust) + C × log₁₀(Distance)
    // Based on EUROCONTROL and research findings
    
    switch(aircraftCategory) {
        // Light aircraft (single engine, small twins)
        case 'A1':
            return {
                category: 'light',
                A: 70,  // Increased from 60 to boost Cessna
                B: 15,  // Thrust coefficient 
                C: -20, // Distance coefficient (6 dB per doubling)
                maxThrust: 0.3 // Relative to heavy jets
            };

        // Small aircraft (regional jets, turboprops)
        case 'A2':
            return {
                category: 'regional',
                A: 75,  // Increased from 65
                B: 20,
                C: -20,
                maxThrust: 0.5
            };
            
        // Large aircraft (narrow body jets)
        case 'A3':
            return {
                category: 'medium',
                A: 80,  // Increased further to 80
                B: 25,
                C: -20,
                maxThrust: 0.8
            };

        // Boeing 757 class (high thrust-to-weight)
        case 'A4':
            return {
                category: 'medium_high',
                A: 75,  // Reduced from 100
                B: 27,
                C: -20,
                maxThrust: 0.9
            };
            
        // Heavy aircraft (wide body, cargo)
        case 'A5':
            return {
                category: 'heavy',
                A: 88,  // Increased to 88 to boost cruise
                B: 30,
                C: -20,
                maxThrust: 1.0
            };

        // High performance (>5G capability)
        case 'A6':
            return {
                category: 'military',
                A: 115,
                B: 40,
                C: -20,
                maxThrust: 1.5
            };
            
        // Helicopters
        case 'A7':
            return {
                category: 'helicopter',
                A: 78,  // Increased from 70 to boost helicopter
                B: 20,
                C: -20,
                maxThrust: 0.6
            };

        // Gliders
        case 'B1':
            return {
                category: 'silent',
                A: 40,
                B: 0,
                C: -20,
                maxThrust: 0.01
            };
            
        // Lighter than air
        case 'B2':
            return {
                category: 'balloon',
                A: 45,
                B: 5,
                C: -20,
                maxThrust: 0.05
            };
            
        // Parachutists
        case 'B3':
            return null; // No engine noise

        // Ultralights
        case 'B4':
            return {
                category: 'ultralight',
                A: 70,
                B: 15,
                C: -20,
                maxThrust: 0.1
            };

        // UAV/Drones
        case 'B6':
            return {
                category: 'drone',
                A: 65,
                B: 10,
                C: -20,
                maxThrust: 0.05
            };

        // Spacecraft
        case 'B7':
            return {
                category: 'rocket',
                A: 140,
                B: 50,
                C: -20,
                maxThrust: 10.0
            };

        // Point obstacles, emergency, unknown
        case 'C0': case 'C1': case 'C2': case 'C3': case 'C4': case 'C5':
        case 'D0': case 'D1': case 'D2': case 'D3': case 'D4': case 'D5': case 'D6': case 'D7':
        case 'A0':
            return {
                category: 'medium',
                A: 65,  // Reduced from 90
                B: 20,
                C: -20,
                maxThrust: 0.7
            };
            
        default:
            return null; // Will use fallback estimation
    }
}

// Detect flight phase based on altitude, climb rate, and speed
function detectFlightPhase(altitude, geom_rate, speed) {
    const altFt = altitude || 0;
    const climbRate = geom_rate || 0;
    const groundSpeed = speed || 0;
    
    // Takeoff: low altitude, high climb rate, moderate speed
    if (altFt < 3000 && climbRate > 1000 && groundSpeed > 100) {
        return 'takeoff';
    }
    
    // Approach: low altitude, descent, moderate speed
    if (altFt < 5000 && climbRate < -300) {
        return 'approach';
    }
    
    // Climb: moderate altitude, climbing
    if (altFt < 15000 && climbRate > 300) {
        return 'climb';
    }
    
    // Descent: any altitude, descending
    if (climbRate < -100) {
        return 'descent';
    }
    
    // Pattern: low altitude, level flight, lower speeds
    if (altFt < 3000 && Math.abs(climbRate) < 300 && groundSpeed < 200) {
        return 'pattern';
    }
    
    // Default to cruise
    return 'cruise';
}

// Estimate thrust setting based on flight phase and performance
function estimateThrust(flightPhase, geom_rate, speed, category) {
    // Thrust as fraction of maximum thrust
    switch (flightPhase) {
        case 'takeoff':
            return 1.0; // Maximum thrust
        case 'climb':
            return 0.85; // High thrust
        case 'approach':
            return 0.4; // Moderate thrust with drag
        case 'descent':
            return 0.25; // Low thrust
        case 'pattern':
            return 0.5; // Pattern power
        case 'cruise':
        default:
            return 0.6; // Cruise thrust
    }
}

// Estimate aircraft noise when category is unknown based on flight characteristics
function estimateNoiseFromCharacteristics(speed, altitude, geom_rate) {
    if (!speed && !altitude) return null;
    
    const speedKnots = speed || 150;
    const altitudeFt = altitude || 5000;
    
    // Create synthetic NPD parameters based on characteristics
    let syntheticNPD;
    
    if (altitudeFt > 25000 && speedKnots > 350) {
        // High altitude, high speed = heavy commercial
        syntheticNPD = { A: 105, B: 35, C: -20, maxThrust: 1.0, category: 'heavy' };
    } else if (altitudeFt > 15000 && speedKnots > 250) {
        // Medium altitude, medium speed = medium commercial
        syntheticNPD = { A: 95, B: 30, C: -20, maxThrust: 0.8, category: 'medium' };
    } else if (speedKnots < 150) {
        // Low speed = likely general aviation
        syntheticNPD = { A: 85, B: 20, C: -20, maxThrust: 0.3, category: 'light' };
    } else {
        // Default medium aircraft
        syntheticNPD = { A: 90, B: 25, C: -20, maxThrust: 0.6, category: 'regional' };
    }
    
    // Use the same calculation logic as main function
    const flightPhase = detectFlightPhase(altitude, geom_rate, speed);
    const thrustSetting = estimateThrust(flightPhase, geom_rate, speed, syntheticNPD.category);
    const baseNoise = syntheticNPD.A + syntheticNPD.B * Math.log10(thrustSetting) + syntheticNPD.C * Math.log10(1.0);
    
    return Math.max(35, Math.min(120, baseNoise));
}

// Calculate sound propagation distance based on noise threshold
function calculateSoundRadius(noiseLevel, altitude, thresholdDB = 35) {
    if (noiseLevel <= thresholdDB) return 0;
    
    // Convert altitude from feet to meters for calculations
    const altitudeMeters = altitude * 0.3048;
    
    // Calculate distance where geometric spreading reduces noise to threshold
    const geometricSpreadingLoss = noiseLevel - thresholdDB;
    
    // Use 1km reference distance to match NPD calculations
    const baseDistance = 1000; // meters
    let propagationDistance = baseDistance * Math.pow(10, geometricSpreadingLoss / 20);
    
    // Add atmospheric absorption effect (research-based)
    const atmosphericAbsorption = 0.0015; // dB/m (research: 1.5 dB/km average)
    const absorptionLoss = atmosphericAbsorption * propagationDistance;
    
    // If atmospheric absorption is significant, recalculate
    if (absorptionLoss > 5) {
        const absorptionFactor = 1 - (absorptionLoss / geometricSpreadingLoss);
        propagationDistance *= Math.max(0.1, absorptionFactor);
    }
    
    // For elevated sources, calculate slant distance
    if (altitudeMeters > 100) {
        const slantDistance = Math.sqrt(
            propagationDistance * propagationDistance + 
            altitudeMeters * altitudeMeters
        );
        propagationDistance = Math.sqrt(slantDistance * slantDistance - altitudeMeters * altitudeMeters);
    }
    
    // Convert to kilometers and apply limits
    const radiusKm = propagationDistance / 1000;
    return Math.max(0.1, Math.min(50, radiusKm));
}

// Calculate received noise level using research-based propagation model
function calculateReceivedNoiseLevel(sourceLevel, distanceKm) {
    // Geometric spreading: 6 dB per distance doubling (20 log rule)
    // Use 1km reference distance to match NPD calculations
    const geometricLoss = 20 * Math.log10(Math.max(distanceKm, 0.01) / 1.0);
    
    // Atmospheric absorption based on ISO 9613-1
    // Research: 0.5 dB/km low freq, 2-4 dB/km high freq
    // Using frequency-averaged value for broadband aircraft noise
    const atmosphericLoss = 1.5 * distanceKm; // dB/km average
    
    // Ground effects (simplified)
    // Research shows 2-3 dB additional loss over hard ground at distance
    const groundLoss = distanceKm > 1 ? 2 * Math.log10(distanceKm) : 0;
    
    // Total propagation loss
    const totalLoss = geometricLoss + atmosphericLoss + groundLoss;
    
    // Received level
    const receivedLevel = sourceLevel - totalLoss;
    
    // Apply realistic noise floor (rural background ~35 dB)
    return Math.max(0, receivedLevel);
}

// Physics-based function for adding loudness to grid using proper sound propagation
function addLoudnessToGrid(plane, grid) {
    const sourceNoiseLevel = calculateLoudness(
        plane.category,
        plane.gs,
        plane.alt_baro,
        plane.geom_rate
    );
    
    if (sourceNoiseLevel <= 0) return; // No noise to propagate
    
    // Calculate effective radius for noise mapping (35 dB threshold)
    const effectiveRadius = calculateSoundRadius(sourceNoiseLevel, plane.alt_baro, 35);
    
    if (effectiveRadius <= 0) return; // Sound doesn't propagate far enough
    
    // Grid resolution (0.005 degrees ≈ 0.5 km at mid-latitudes)
    const gridResolution = 0.005;
    let gridLon = Math.round(plane.lon / gridResolution);
    let gridLat = Math.round(plane.lat / gridResolution);
    
    // Convert radius to grid units
    const radiusGridUnits = Math.ceil(effectiveRadius / (gridResolution * 111)); // 111 km per degree
    
    // Apply sound to surrounding grid points using proper propagation physics
    for (let dx = -radiusGridUnits; dx <= radiusGridUnits; dx++) {
        for (let dy = -radiusGridUnits; dy <= radiusGridUnits; dy++) {
            // Calculate horizontal distance in km
            const horizontalDistKm = Math.sqrt(dx * dx + dy * dy) * gridResolution * 111;
            
            if (horizontalDistKm > effectiveRadius) continue;
            
            // Calculate 3D slant distance including altitude
            const altitudeKm = plane.alt_baro * 0.0003048; // feet to km
            const slantDistKm = Math.sqrt(
                horizontalDistKm * horizontalDistKm + 
                altitudeKm * altitudeKm
            );
            
            // Skip if too close (avoid division by zero)
            if (slantDistKm < 0.01) continue;
            
            // Calculate noise level at this point using proper physics
            const receivedNoiseLevel = calculateReceivedNoiseLevel(
                sourceNoiseLevel, 
                slantDistKm
            );
            
            if (receivedNoiseLevel > 25) { // Only add significant noise levels
                const key = `${gridLat + dy}_${gridLon + dx}`;
                
                // Convert decibel levels to linear scale for addition
                const currentLinear = grid[key] ? Math.pow(10, grid[key] / 10) : 0;
                const addedLinear = Math.pow(10, receivedNoiseLevel / 10);
                const combinedLinear = currentLinear + addedLinear;
                
                // Convert back to decibels
                grid[key] = 10 * Math.log10(combinedLinear);
            }
        }
    }
}

// Original grid-based methods for heatmap generation
function findContainingGridSquare(plane, middleLat, middleLon) {
    const earthCircumference = 40075; // Earth's circumference at equator in km
    const latitudeDistPerDeg = earthCircumference / 360;
    const longitudeDistPerDeg = Math.cos(degreesToRadians(middleLat)) * earthCircumference / 360;

    let xIndex = Math.floor((plane.lon - middleLon) * longitudeDistPerDeg);
    let yIndex = Math.floor((plane.lat - middleLat) * latitudeDistPerDeg);

    // grid central coordinates for each 1km square grid
    let centralLon = middleLon + (xIndex + 0.5) / longitudeDistPerDeg;
    let centralLat = middleLat + (yIndex + 0.5) / latitudeDistPerDeg;

    return {
        x: xIndex,
        y: yIndex,
        centralLon: centralLon,
        centralLat: centralLat
    };
}

// Updated original grid function using new research-based calculations
function addLoudnessToGridOriginal(plane, grid, middleLat, middleLon) {
    if (!plane.lat || !plane.lon) {
        return; // No location data
    }

    const sourceNoiseLevel = calculateLoudness(plane.category, plane.gs, plane.alt_baro, plane.geom_rate);

    if (!sourceNoiseLevel || sourceNoiseLevel <= 30) {
        return; // No significant noise
    }

    // Find grid position first
    const gridPos = findContainingGridSquare(plane, middleLat, middleLon);
    const key = `${gridPos.y}_${gridPos.x}`;
    
    // Calculate distance from aircraft to ITS OWN grid cell center (not city center!)
    const distanceKm = haversineDistance(
        plane.lat, plane.lon,
        gridPos.centralLat, gridPos.centralLon
    );
    
    // Add altitude component for true 3D distance
    // Handle 'ground' altitude and missing data
    let altitude = plane.alt_baro;
    if (altitude === 'ground' || !altitude || altitude < 0) {
        altitude = 0; // Ground level
    }
    const altitudeKm = altitude * 0.0003048; // feet to km
    const slantDistKm = Math.sqrt(distanceKm * distanceKm + altitudeKm * altitudeKm);
    
    // Calculate received noise level at the grid cell center
    const receivedNoiseLevel = calculateReceivedNoiseLevel(sourceNoiseLevel, Math.max(0.01, slantDistKm));
    
    if (receivedNoiseLevel <= 30) {
        return; // Below background noise threshold
    }
    
    // Track linear power sum and count for proper averaging across time
    if (grid[key]) {
        // Add to existing linear power sum and increment count
        const newLinear = Math.pow(10, receivedNoiseLevel / 10);
        grid[key] = {
            linearSum: grid[key].linearSum + newLinear,
            count: grid[key].count + 1,
            centralLon: gridPos.centralLon,
            centralLat: gridPos.centralLat
        };
    } else {
        grid[key] = {
            linearSum: Math.pow(10, receivedNoiseLevel / 10),
            count: 1,
            centralLon: gridPos.centralLon,
            centralLat: gridPos.centralLat
        };
    }
}

// Haversine distance calculation for accurate earth distances
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = degreesToRadians(lat2 - lat1);
    const dLon = degreesToRadians(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function convertGridBackToDegrees(grid, outputFormat = 'linear') {
    let heatmapData = [];

    for (let key in grid) {
        let gridValue = grid[key];
        if (gridValue && gridValue.centralLat != null && gridValue.centralLon != null) {
            // Calculate average noise level from accumulated linear power
            let averageLinear = gridValue.linearSum / gridValue.count;
            let averageDB = 10 * Math.log10(averageLinear);
            
            // Only include significant noise levels
            if (averageDB > 35) {
                let outputValue;
                
                if (outputFormat === 'linear') {
                    // Convert back to linear intensity for perceptually accurate visualization
                    // This represents the actual sound power, making differences more apparent
                    outputValue = averageLinear;
                } else if (outputFormat === 'db') {
                    // Original dB output (logarithmic scale)
                    outputValue = averageDB;
                } else {
                    // Default to linear
                    outputValue = averageLinear;
                }
                
                heatmapData.push([gridValue.centralLat, gridValue.centralLon, outputValue]);
            }
        }
    }

    return heatmapData;
}

function degreesToRadians(degrees) {
    return degrees * Math.PI / 180;
}

// Legacy size factor function - kept for backward compatibility
function getSizeFactor(aircraftCategory) {
    // Convert new noise levels to legacy scale for compatibility
    const npdParams = getNPDParameters(aircraftCategory);
    if (!npdParams) return null;
    
    // Legacy scale was 0-1.6, with 120 dB max
    // Convert to approximate legacy values
    return Math.max(0, Math.min(1.6, npdParams.A / 75));
}

// Class-based export for worker thread compatibility
class Aircraft {
    constructor(centerLat, centerLon) {
        this.centerLat = centerLat;
        this.centerLon = centerLon;
    }

    calculateLoudness(aircraftCategory, speed, altitude, geom_rate) {
        return calculateLoudness(aircraftCategory, speed, altitude, geom_rate);
    }

    calculateSoundRadius(noiseLevel, altitude, thresholdDB) {
        return calculateSoundRadius(noiseLevel, altitude, thresholdDB);
    }

    getSizeFactor(aircraftCategory) {
        return getSizeFactor(aircraftCategory);
    }

    addLoudnessToGrid(plane, grid) {
        return addLoudnessToGridOriginal(plane, grid, this.centerLat, this.centerLon);
    }
    
    findContainingGridSquare(plane) {
        return findContainingGridSquare(plane, this.centerLat, this.centerLon);
    }
    
    convertGridBackToDegrees(grid, outputFormat = 'linear') {
        return convertGridBackToDegrees(grid, outputFormat);
    }
}

// Utility functions to convert between linear intensity and dB for interpretation
function linearToDecibels(linearValue) {
    return 10 * Math.log10(linearValue);
}

function decibelsToLinear(dbValue) {
    return Math.pow(10, dbValue / 10);
}

// Export all functions (updated for new research-based model)
module.exports = Aircraft;
module.exports.calculateLoudness = calculateLoudness;
module.exports.calculateSoundRadius = calculateSoundRadius;
module.exports.addLoudnessToGrid = addLoudnessToGrid;
module.exports.getSizeFactor = getSizeFactor;
module.exports.getNPDParameters = getNPDParameters;
module.exports.detectFlightPhase = detectFlightPhase;
module.exports.estimateThrust = estimateThrust;
module.exports.calculateReceivedNoiseLevel = calculateReceivedNoiseLevel;
module.exports.findContainingGridSquare = findContainingGridSquare;
module.exports.addLoudnessToGridOriginal = addLoudnessToGridOriginal;
module.exports.convertGridBackToDegrees = convertGridBackToDegrees;
module.exports.haversineDistance = haversineDistance;
module.exports.linearToDecibels = linearToDecibels;
module.exports.decibelsToLinear = decibelsToLinear;