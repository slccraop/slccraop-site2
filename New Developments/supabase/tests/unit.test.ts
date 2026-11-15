import { describe, expect, it } from 'vitest';
import {
  decryptText,
  encryptText,
  constantTimeEqual,
  formatTrackingCode,
  hmacHex,
  newTrackingCode,
  normaliseTrackingCode,
  sha256Hex,
} from '../functions/_shared/crypto.ts';
import { TRACKING_ALPHABET, TRACKING_LENGTH } from '../functions/_shared/contracts.ts';
import { sniffMime, stripMetadata } from '../functions/_shared/image.ts';
import {
  buildIdentifiers,
  canonicalLink,
  normalisePhone,
  normaliseUsername,
} from '../functions/_shared/normalise.ts';
import { PEPPER, PHONE_KEY, contains, makeJpeg, makePng, makeWebp } from './support';

const rng = (n: number) => crypto.getRandomValues(new Uint8Array(n));

describe('tracking codes', () => {
  it('have 20 symbols from the unambiguous alphabet and group as 5 x 4', () => {
    for (let i = 0; i < 200; i++) {
      const c = newTrackingCode(rng);
      expect(c).toHaveLength(TRACKING_LENGTH);
      for (const ch of c) expect(TRACKING_ALPHABET).toContain(ch);
      expect(formatTrackingCode(c)).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$/);
      expect(normaliseTrackingCode(formatTrackingCode(c).toLowerCase())).toBe(c);
    }
  });
  it('are not repeated', () =>
    expect(new Set(Array.from({ length: 500 }, () => newTrackingCode(rng))).size).toBe(500));
  it('use every symbol roughly evenly (no modulo bias)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i++)
      for (const ch of newTrackingCode(rng)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const values = [...counts.values()];
    expect(values).toHaveLength(32);
    expect(Math.min(...values)).toBeGreaterThan(1500 * 0.85);
    expect(Math.max(...values)).toBeLessThan(1875 * 1.15);
  });
});

describe('hashing and encryption', () => {
  it('hmac is keyed and stable', async () => {
    const a = await hmacHex(PEPPER, 'x');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacHex(PEPPER, 'x')).toBe(a);
    expect(await hmacHex(PHONE_KEY, 'x')).not.toBe(a);
    expect(await hmacHex(PEPPER, 'y')).not.toBe(a);
  });
  it('sha256 matches a known value', async () =>
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ));
  it('encrypts phone numbers with a fresh IV each time and refuses tampering', async () => {
    const a = await encryptText(PHONE_KEY, '+94771234567', rng);
    const b = await encryptText(PHONE_KEY, '+94771234567', rng);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(contains(a, '94771234567')).toBe(false);
    expect(await decryptText(PHONE_KEY, a)).toBe('+94771234567');
    const bad = new Uint8Array(a);
    bad[bad.length - 1] = (bad[bad.length - 1] as number) ^ 1;
    await expect(decryptText(PHONE_KEY, bad)).rejects.toThrow();
    await expect(decryptText(PEPPER, a)).rejects.toThrow();
  });
  it('compares secrets in constant time and correctly', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('phone and link normalisation', () => {
  it.each([
    ['+94 77 123 4567', '+94771234567'],
    ['0771234567', '+94771234567'],
    ['0094771234567', '+94771234567'],
    ['+44 (20) 7946-0958', '+442079460958'],
  ])('phone %s', (raw, want) => expect(normalisePhone(raw)).toBe(want));
  it.each(['12345', '+0123456789', 'abc', '+94 77', ''])('rejects phone %j', (raw) =>
    expect(normalisePhone(raw)).toBeNull(),
  );

  it('collapses the many forms of one Facebook profile, page and group', () => {
    const same = (...links: string[]) => {
      const set = new Set(links.map((l) => JSON.stringify(canonicalLink(l))));
      expect([...set], links.join(' | ')).toHaveLength(1);
      expect(canonicalLink(links[0] as string)).not.toBeNull();
    };
    same(
      'https://www.facebook.com/groups/Example-Group-1',
      'https://m.facebook.com/groups/example-group-1/?ref=share&fbclid=abc',
      'facebook.com/groups/EXAMPLE-GROUP-1/',
      'https://mbasic.facebook.com/groups/example-group-1?__tn__=x',
    );
    same(
      'https://www.facebook.com/profile.php?id=100012345',
      'https://m.facebook.com/profile.php?id=100012345&ref=bookmarks',
      'https://fb.com/profile.php?id=100012345',
    );
    same(
      'https://www.facebook.com/pages/Some-Page/987654321',
      'https://facebook.com/pages/other-slug/987654321/',
    );
    expect(canonicalLink('https://facebook.com/John.Doe?ref=x')).toEqual({
      type: 'username',
      canonical: 'john.doe',
    });
    expect(canonicalLink('https://www.instagram.com/John.Doe/?igshid=zzz')).toEqual({
      type: 'username',
      canonical: 'john.doe',
    });
    expect(canonicalLink('https://www.tiktok.com/@John.Doe?lang=en')).toEqual({
      type: 'username',
      canonical: 'john.doe',
    });
    expect(canonicalLink('https://twitter.com/Some_One')).toEqual(canonicalLink('https://x.com/some_one'));
  });
  it('rejects things that are not links', () => {
    for (const bad of ['javascript:alert(1)', 'not a link', 'ftp://x.test/a', 'https://localhost/a', ''])
      expect(canonicalLink(bad), bad).toBeNull();
  });
  it('typed usernames match the same account written as a link', () => {
    expect(buildIdentifiers(['https://facebook.com/John.Doe?ref=x'], ['@john.DOE'])).toEqual([
      { type: 'username', canonical: 'john.doe' },
    ]);
    expect(normaliseUsername('  @@Name ')).toBe('name');
    expect(normaliseUsername('two words')).toBeNull();
  });
});

describe('image handling', () => {
  it('identifies images by content, not by what the browser claims', () => {
    expect(sniffMime(makePng())).toBe('image/png');
    expect(sniffMime(makeJpeg())).toBe('image/jpeg');
    expect(sniffMime(makeWebp())).toBe('image/webp');
    expect(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffMime(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });
  it('strips location and comments from PNG, JPEG and WebP but keeps the picture data', () => {
    for (const [file, mime] of [
      [makePng(), 'image/png'],
      [makeJpeg(), 'image/jpeg'],
      [makeWebp(), 'image/webp'],
    ] as const) {
      expect(contains(file, 'GPS-SECRET-LOCATION'), mime).toBe(true);
      const clean = stripMetadata(file, mime);
      expect(contains(clean, 'GPS-SECRET-LOCATION'), mime).toBe(false);
      expect(sniffMime(clean), mime).toBe(mime);
      expect(clean.length, mime).toBeLessThan(file.length);
    }
    expect(contains(stripMetadata(makeJpeg(), 'image/jpeg'), 'JFIF')).toBe(true);
    expect(contains(stripMetadata(makeJpeg(), 'image/jpeg'), 'camera comment')).toBe(false);
    expect(contains(stripMetadata(makePng(), 'image/png'), 'IDAT')).toBe(true);
    const webp = stripMetadata(makeWebp(), 'image/webp');
    expect(webp[20]! & 0x0c).toBe(0); // VP8X flags no longer promise EXIF or XMP
    expect(webp[4]! | (webp[5]! << 8) | (webp[6]! << 16)).toBe(webp.length - 8); // RIFF size is consistent
  });
  it('refuses malformed files instead of passing them through', () => {
    expect(() => stripMetadata(makePng().slice(0, 30), 'image/png')).toThrow();
    expect(() => stripMetadata(makeJpeg().slice(0, 12), 'image/jpeg')).toThrow();
  });
});
