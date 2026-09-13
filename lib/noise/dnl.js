/**
 * Day-night average sound level bookkeeping and the value encodings used
 * in the image tiles.
 */
const SECONDS_PER_DAY = 86400;
const NIGHT_WEIGHT = 10;      // +10 dB between 22:00 and 07:00
const CUTOFF_DB = 35;         // received levels below this are ignored

/** Local solar hour (0..24) for a UTC unix time and longitude. */
function localSolarHour(unixSeconds, lon) {
    const h = ((unixSeconds / 3600) + lon / 15) % 24;
    return h < 0 ? h + 24 : h;
}

function isNight(unixSeconds, lon) {
    const h = localSolarHour(unixSeconds, lon);
    return h < 7 || h >= 22;
}

function nightWeight(unixSeconds, lon) {
    return isNight(unixSeconds, lon) ? NIGHT_WEIGHT : 1;
}

/** Weighted energy-seconds accumulated over the day -> DNL in dB. */
function energyToDb(weightedEnergySeconds) {
    if (weightedEnergySeconds <= 0) return -Infinity;
    return 10 * Math.log10(weightedEnergySeconds / SECONDS_PER_DAY);
}

function dbToEnergy(db) {
    return Math.pow(10, db / 10);
}

// Tile pixel encodings. 0 always means "no data / below cutoff".
const DB_OFFSET = 30, DB_STEP = 0.25;

function encodeDb(db) {
    if (!(db >= CUTOFF_DB)) return 0;
    const v = Math.round((db - DB_OFFSET) / DB_STEP);
    return v < 1 ? 1 : v > 255 ? 255 : v;
}

function decodeDb(v) {
    return v === 0 ? null : DB_OFFSET + v * DB_STEP;
}

function encodeTraffic(seconds) {
    if (!(seconds > 0)) return 0;
    const v = Math.round(40 * Math.log10(1 + seconds));
    return v < 1 ? 1 : v > 255 ? 255 : v;
}

function decodeTraffic(v) {
    return v === 0 ? null : Math.pow(10, v / 40) - 1;
}

module.exports = {
    SECONDS_PER_DAY, NIGHT_WEIGHT, CUTOFF_DB, DB_OFFSET, DB_STEP,
    localSolarHour, isNight, nightWeight, energyToDb, dbToEnergy,
    encodeDb, decodeDb, encodeTraffic, decodeTraffic
};
