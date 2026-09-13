const config = require('../config');

describe('Configuration', () => {
  test('server configuration', () => {
    expect(typeof config.server.port).toBe('number');
    expect(typeof config.server.host).toBe('string');
  });

  test('processing configuration', () => {
    expect(typeof config.processing.lightweightMode).toBe('boolean');
    expect(config.processing.concurrencyLimit).toBeGreaterThan(0);
    expect(Number.isInteger(config.processing.workerThreads)).toBe(true);
    expect(config.processing.workerThreads).toBeGreaterThanOrEqual(1);
  });

  test('paths are complete and relative', () => {
    expect(config.paths).toEqual({
      flightHistory: 'data/flight-history',
      flightPaths: 'data/flightpaths',
      terrain: 'data/terrain',
      noise: 'data/noise',
      tiles: 'data/tiles',
      site: 'docs'
    });
    Object.values(config.paths).forEach(p => expect(p.startsWith('/')).toBe(false));
  });

  test('cities have valid coordinates and key style', () => {
    const names = Object.keys(config.cities);
    expect(names.length).toBeGreaterThan(20);
    names.forEach(name => {
      expect(name).toMatch(/^[A-Z]{2,3}(_[A-Z]{2})?_[A-Za-z]+$/);
      const { lat, lon } = config.cities[name];
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    });
    ['AUS_Sydney', 'SGP_Singapore', 'ARE_Dubai', 'DE_Frankfurt', 'NLD_Amsterdam',
      'MEX_MexicoCity', 'BRA_SaoPaulo', 'IND_Mumbai', 'HKG_HongKong', 'ZAF_Johannesburg',
      'USA_WA_Seattle', 'GBR_London'].forEach(c => expect(config.cities[c]).toBeDefined());
  });

  test('default radii', () => {
    expect(Array.isArray(config.defaultRadii)).toBe(true);
    expect(config.defaultRadii.length).toBeGreaterThan(0);
    config.defaultRadii.forEach(r => expect(r).toBeGreaterThan(0));
  });

  test('ADS-B Exchange configuration', () => {
    expect(config.adsbExchange.baseUrl).toMatch(/^https:\/\//);
    expect(config.adsbExchange.getDatePath('2023-09-01')).toBe('2023/09/01');
    expect(() => config.adsbExchange.getDatePath('2023/09/01')).toThrow();
  });

  test('default date', () => {
    expect(config.defaultDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('terrain sources', () => {
    expect(config.terrain.sources).toHaveLength(2);
    expect(config.terrain.sources[0]).toMatch(/ETOPO_2022_v1_60s_N90W180_surface\.nc$/);
    expect(config.terrain.sources[1]).toMatch(/airports\.csv$/);
  });
});
