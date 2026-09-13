/**
 * Geographical calculation utilities
 */
const EARTH_RADIUS_MILES = 3958.8;
const EARTH_RADIUS_KM = 6371.0;
const MILES_PER_DEG_LAT = 69.09;

class Geo {
    /**
     * Great-circle distance in miles (haversine).
     */
    static distanceInMiles(lat1, lon1, lat2, lon2) {
        return EARTH_RADIUS_MILES * Geo.centralAngle(lat1, lon1, lat2, lon2);
    }

    /**
     * Great-circle distance in kilometres (haversine).
     */
    static distanceInKm(lat1, lon1, lat2, lon2) {
        return EARTH_RADIUS_KM * Geo.centralAngle(lat1, lon1, lat2, lon2);
    }

    /**
     * Central angle between two points, in radians.
     */
    static centralAngle(lat1, lon1, lat2, lon2) {
        const φ1 = Geo.toRadians(lat1);
        const φ2 = Geo.toRadians(lat2);
        const Δφ = Geo.toRadians(lat2 - lat1);
        const Δλ = Geo.toRadians(lon2 - lon1);

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Cheap bounding-box test used to skip the haversine for far-away
     * points. Returns true when the point may be within `radiusMiles`.
     * Conservative: never rejects a point that is inside the radius.
     */
    static withinBoundingBox(lat1, lon1, lat2, lon2, radiusMiles) {
        const dLatDeg = radiusMiles / MILES_PER_DEG_LAT;
        if (Math.abs(lat2 - lat1) > dLatDeg) return false;
        const cos = Math.cos(Geo.toRadians(lat1));
        if (cos < 0.05) return true; // near the poles, let the haversine decide
        let dLon = Math.abs(lon2 - lon1);
        if (dLon > 180) dLon = 360 - dLon;
        return dLon <= dLatDeg / cos;
    }

    static toRadians(degrees) {
        return degrees * Math.PI / 180;
    }
}

module.exports = Geo;
