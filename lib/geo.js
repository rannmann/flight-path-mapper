// Geo class for handling geolocation calculations
// Dependencies: none
//
// Usage:
// const Geo = require('./lib/geo');
// const geo = new Geo();

class Geo {
    /**
     * Calculate distance between two geographical coordinates.
     *
     * @param {float} lat1
     * @param {float} lon1
     * @param {float} lat2
     * @param {float} lon2
     * @returns {number} Miles
     */
      static distanceInMiles(lat1, lon1, lat2, lon2) {
        let R = 3958.8; // Radius of the earth in miles
        let φ1 = this.toRadians(lat1);
        let φ2 = this.toRadians(lat2);
        let Δφ = this.toRadians(lat2 - lat1);
        let Δλ = this.toRadians(lon2 - lon1);

        let a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * Convert degrees to radians.
     *
     * @param {float} degrees
     * @returns {number}
     */
    static toRadians(degrees) {
        return degrees * Math.PI / 180;
    }
}

module.exports = Geo;