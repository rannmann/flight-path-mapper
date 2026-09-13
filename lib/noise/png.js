/**
 * Minimal 8-bit greyscale PNG encoder/decoder (no dependencies).
 * The decoder only supports what the encoder writes (filter type 0,
 * non-interlaced, colour type 0, bit depth 8).
 */
const zlib = require('zlib');

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
}

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crc]);
}

/** Encode a width x height Uint8Array of grey values. */
function encodeGray(pixels, width, height, { level = 9 } = {}) {
    if (pixels.length !== width * height) throw new Error('pixel count mismatch');
    const raw = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width + 1)] = 0; // filter: none
        raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 0;  // colour type: greyscale
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

/** Decode a PNG written by encodeGray. Returns {width, height, pixels}. */
function decodeGray(buf) {
    let off = 8, width = 0, height = 0;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            if (data[8] !== 8 || data[9] !== 0) throw new Error('unsupported PNG (need 8-bit grey)');
        } else if (type === 'IDAT') {
            idat.push(data);
        }
        off += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        if (raw[y * (width + 1)] !== 0) throw new Error('unsupported PNG filter');
        pixels.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
    }
    return { width, height, pixels };
}

module.exports = { encodeGray, decodeGray, crc32 };
