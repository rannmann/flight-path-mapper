const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { snapshotNames, tolerableFailures, parseArgs, gzipIsReadable } = require('../download');

describe('download helpers', () => {
  test('snapshotNames covers a day at 5 s', () => {
    const names = snapshotNames();
    expect(names).toHaveLength(17280);
    expect(names[0]).toBe('000000Z.json.gz');
    expect(names[1]).toBe('000005Z.json.gz');
    expect(names[720]).toBe('010000Z.json.gz');
    expect(names[names.length - 1]).toBe('235955Z.json.gz');
    expect(new Set(names).size).toBe(17280);
  });

  test('tolerableFailures is 1 % with a floor of 5', () => {
    expect(tolerableFailures(17280)).toBe(172);
    expect(tolerableFailures(100)).toBe(5);
    expect(tolerableFailures(0)).toBe(5);
  });

  test('parseArgs', () => {
    expect(parseArgs(['--date', '2025-10-01', '--verify'])).toEqual({ terrain: false, verify: true, date: '2025-10-01' });
    expect(parseArgs(['--date=2025-10-01'])).toEqual({ terrain: false, verify: false, date: '2025-10-01' });
    expect(parseArgs(['--terrain']).terrain).toBe(true);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });

  test('gzipIsReadable distinguishes gzip from decompressed JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
    const gz = path.join(dir, 'a.json.gz'), plain = path.join(dir, 'b.json.gz');
    fs.writeFileSync(gz, zlib.gzipSync('{"aircraft":[]}'));
    fs.writeFileSync(plain, '{"aircraft":[]}');
    expect(gzipIsReadable(gz)).toBe(true);
    expect(gzipIsReadable(plain)).toBe(false);
    expect(gzipIsReadable(path.join(dir, 'missing'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
