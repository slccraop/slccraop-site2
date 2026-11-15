// Evidence files: identify by magic bytes (never by extension or the declared type) and strip metadata.
// The untouched original is stored for chain of custody; admins only ever see the stripped copy.
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export function sniffMime(b: Uint8Array): ImageMime | null {
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x))
    return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const tag = (o: number, s: string) => s.split('').every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b.length >= 12 && tag(0, 'RIFF') && tag(8, 'WEBP')) return 'image/webp';
  return null;
}
export const EXTENSION: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u32be = (b: Uint8Array, o: number) =>
  (b[o] as number) * 2 ** 24 +
  (((b[o + 1] as number) << 16) | ((b[o + 2] as number) << 8) | (b[o + 3] as number));
const u32le = (b: Uint8Array, o: number) =>
  (b[o] as number) |
  ((b[o + 1] as number) << 8) |
  ((b[o + 2] as number) << 16) |
  ((b[o + 3] as number) * 2 ** 24);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG']);
function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.slice(0, 8)];
  let o = 8;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const end = o + 12 + len;
    if (end > b.length) throw new Error('truncated png');
    if (!PNG_DROP.has(ascii(b, o + 4, 4))) parts.push(b.slice(o, end));
    o = end;
  }
  return concat(parts);
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.slice(0, 2)];
  let o = 2;
  while (o < b.length) {
    if (b[o] !== 0xff) throw new Error('bad jpeg');
    while (b[o + 1] === 0xff) o++; // fill bytes
    const marker = b[o + 1] as number;
    if (marker === 0xda) {
      parts.push(b.slice(o));
      return concat(parts);
    } // start of scan: the rest is image data
    if (marker === 0xd9) {
      parts.push(b.slice(o, o + 2));
      return concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(b.slice(o, o + 2));
      o += 2;
      continue;
    }
    const len = ((b[o + 2] as number) << 8) | (b[o + 3] as number);
    if (len < 2 || o + 2 + len > b.length) throw new Error('truncated jpeg');
    const seg = b.slice(o, o + 2 + len);
    const keep =
      marker === 0xe0 || // JFIF
      (marker === 0xe2 && ascii(seg, 4, 12) === 'ICC_PROFILE\0') || // colour profile
      (marker === 0xee && ascii(seg, 4, 5) === 'Adobe') || // colour transform needed to render some files
      (!(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe); // everything that is not an APPn or comment
    if (keep) parts.push(seg);
    o += 2 + len;
  }
  throw new Error('jpeg without scan');
}

function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let o = 12;
  while (o + 8 <= b.length) {
    const fourcc = ascii(b, o, 4);
    const size = u32le(b, o + 4);
    const end = o + 8 + size + (size % 2);
    if (end > b.length + 1) throw new Error('truncated webp');
    const chunk = b.slice(o, Math.min(end, b.length));
    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      o = end;
      continue;
    }
    if (fourcc === 'VP8X') chunk[8] = (chunk[8] as number) & ~0x0c; // clear the EXIF and XMP flags
    parts.push(chunk);
    o = end;
  }
  const body = concat(parts);
  const head = new Uint8Array(12);
  head.set(b.slice(0, 12));
  const total = body.length + 4;
  head[4] = total & 0xff;
  head[5] = (total >> 8) & 0xff;
  head[6] = (total >> 16) & 0xff;
  head[7] = (total >>> 24) & 0xff;
  return concat([head, body]);
}

/** A copy with location, camera, comments and other embedded metadata removed. Throws on a malformed file. */
export function stripMetadata(bytes: Uint8Array, mime: ImageMime): Uint8Array {
  if (mime === 'image/png') return stripPng(bytes);
  if (mime === 'image/jpeg') return stripJpeg(bytes);
  return stripWebp(bytes);
}
