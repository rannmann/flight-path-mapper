/**
 * Geographical calculation utilities
 */
class Geo {
    /**
     * Calculate distance between two geographical coordinates in miles
     * @param {number} lat1 - Latitude of first point
     * @param {number} lon1 - Longitude of first point
     * @param {number} lat2 - Latitude of second point
     * @param {number} lon2 - Longitude of second point
     * @returns {number} Distance in miles
     */
    static distanceInMiles(lat1, lon1, lat2, lon2) {
        const R = 3958.8; // Radius of the earth in miles
        const φ1 = Geo.toRadians(lat1);
        const φ2 = Geo.toRadians(lat2);
        const Δφ = Geo.toRadians(lat2 - lat1);
        const Δλ = Geo.toRadians(lon2 - lon1);

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * Convert degrees to radians
     * @param {number} degrees
     * @returns {number} Radians
     */
    static toRadians(degrees) {
        return degrees * Math.PI / 180;
    }
}

module.exports = Geo;