const { encodeGray, decodeGray, crc32 } = require('../lib/noise/png');

describe('greyscale PNG', () => {
  test('encodeGray/decodeGray round trip for a 7x5 image', () => {
    const width = 7, height = 5;
    const pixels = new Uint8Array(width * height);
    let seed = 12345;
    for (let i = 0; i < pixels.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      pixels[i] = seed >>> 24;
    }
    pixels[0] = 0; pixels[pixels.length - 1] = 255;

    const png = encodeGray(pixels, width, height);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);

    const decoded = decodeGray(png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  test('rejects a size mismatch', () => {
    expect(() => encodeGray(new Uint8Array(10), 3, 4)).toThrow(/mismatch/);
  });

  test('a solid image compresses well and decodes', () => {
    const pixels = new Uint8Array(256 * 256).fill(7);
    const png = encodeGray(pixels, 256, 256);
    expect(png.length).toBeLessThan(1000);
    expect(decodeGray(png).pixels.every(v => v === 7)).toBe(true);
  });

  test('crc32 matches the reference value for "IEND"', () => {
    expect(crc32(Buffer.from('IEND', 'ascii'))).toBe(0xAE426082);
  });
});
