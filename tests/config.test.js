const config = require('../config');

describe('Configuration', () => {
  test('should have default server configuration', () => {
    expect(config.server.port).toBeDefined();
    expect(config.server.host).toBeDefined();
    expect(typeof config.server.port).toBe('number');
  });

  test('should have processing configuration', () => {
    expect(config.processing).toBeDefined();
    expect(typeof config.processing.lightweightMode).toBe('boolean');
    expect(typeof config.processing.concurrencyLimit).toBe('number');
    expect(config.processing.concurrencyLimit).toBeGreaterThan(0);
  });

  test('should have path configuration', () => {
    expect(config.paths.flightHistory).toBeDefined();
    expect(config.paths.flightPaths).toBeDefined();
    expect(config.paths.aircraftData).toBeDefined();
  });

  test('should have cities configuration', () => {
    expect(config.cities).toBeDefined();
    expect(typeof config.cities).toBe('object');
    
    // Check that cities have required lat/lon properties
    Object.values(config.cities).forEach(city => {
      expect(city.lat).toBeDefined();
      expect(city.lon).toBeDefined();
      expect(typeof city.lat).toBe('number');
      expect(typeof city.lon).toBe('number');
      expect(city.lat).toBeGreaterThanOrEqual(-90);
      expect(city.lat).toBeLessThanOrEqual(90);
      expect(city.lon).toBeGreaterThanOrEqual(-180);
      expect(city.lon).toBeLessThanOrEqual(180);
    });
  });

  test('should have valid default radii', () => {
    expect(Array.isArray(config.defaultRadii)).toBe(true);
    expect(config.defaultRadii.length).toBeGreaterThan(0);
    config.defaultRadii.forEach(radius => {
      expect(typeof radius).toBe('number');
      expect(radius).toBeGreaterThan(0);
    });
  });

  test('should have ADS-B Exchange configuration', () => {
    expect(config.adsbExchange.baseUrl).toBeDefined();
    expect(typeof config.adsbExchange.getDatePath).toBe('function');
    
    // Test date path function
    const datePath = config.adsbExchange.getDatePath('2023-09-01');
    expect(datePath).toBe('2023/09/01');
  });
});