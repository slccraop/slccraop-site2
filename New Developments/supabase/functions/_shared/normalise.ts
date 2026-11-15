// Normalisation before hashing (manual 5.7): the same suspect written five different ways must hash the same.
export type IdentifierType = 'profile' | 'group' | 'page' | 'username';
export interface Identifier {
  type: IdentifierType;
  canonical: string;
}

/** Phone to E.164. Accepts +94 77 123 4567, 0094..., and Sri Lankan local 077 123 4567. Returns null if it is not plausible. */
export function normalisePhone(raw: string): string | null {
  let s = raw.replace(/[\s().-]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  else if (/^0[1-9]\d{8}$/.test(s)) s = '+94' + s.slice(1); // local Sri Lankan format
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

export function normaliseUsername(raw: string): string | null {
  const s = raw.trim().replace(/^@+/, '').toLowerCase();
  return s.length >= 1 && s.length <= 100 && !/\s/.test(s) ? s : null;
}

const FB_RESERVED = new Set([
  'watch',
  'marketplace',
  'events',
  'hashtag',
  'photo',
  'photo.php',
  'permalink.php',
  'story.php',
  'sharer',
  'share',
  'reel',
  'reels',
  'login',
  'help',
  'policies',
  'stories',
  'gaming',
  'pg',
  'public',
  'search',
  'videos',
  'posts',
  'l.php',
]);
const PREFIXES = /^(www|m|mbasic|web|mobile|touch|l|lm)\./;
const safe = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Canonical form of a profile, page, group or account link. Mobile and www hosts collapse to one host, tracking
 * parameters are discarded (only profile.php?id= is kept), and Facebook forms resolve to the stable ID or username.
 */
export function canonicalLink(raw: string): Identifier | null {
  const text = raw.trim();
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : 'https://' + text);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
  let host = u.hostname.toLowerCase().replace(PREFIXES, '');
  if (host === 'fb.com') host = 'facebook.com';
  if (host === 'twitter.com') host = 'x.com';
  const segs = u.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => safe(s).toLowerCase());
  const first = segs[0];

  if (host === 'facebook.com') {
    if (first === 'groups' && segs[1]) return { type: 'group', canonical: `facebook.com/groups/${segs[1]}` };
    if (first === 'profile.php') {
      const id = u.searchParams.get('id');
      return id && /^\d+$/.test(id) ? { type: 'profile', canonical: `facebook.com/id/${id}` } : null;
    }
    if (first === 'people' && /^\d+$/.test(segs[2] ?? ''))
      return { type: 'profile', canonical: `facebook.com/id/${segs[2]}` };
    if (first === 'pages' && segs.length >= 2) {
      const last = segs[segs.length - 1] as string;
      return {
        type: 'page',
        canonical: /^\d+$/.test(last) ? `facebook.com/page/${last}` : `facebook.com/pages/${segs[1]}`,
      };
    }
    if (first && !FB_RESERVED.has(first)) return { type: 'username', canonical: first.replace(/^@/, '') };
    return null;
  }
  if (!first) return null;
  if (['instagram.com', 'tiktok.com', 'x.com', 't.me', 'youtube.com', 'snapchat.com'].includes(host)) {
    const name =
      first === 'add' || first === 'channel' || first === 'user' || first === 'c' ? segs[1] : first;
    if (name && !['p', 'reel', 'reels', 'explore', 'watch', 'status', 'i', 'share', 'video'].includes(name)) {
      return { type: 'username', canonical: name.replace(/^@/, '') };
    }
  }
  return { type: 'page', canonical: `${host}/${segs.join('/')}` };
}

/** Every distinct identifier from the reporter's links and usernames. Duplicates collapse. */
export function buildIdentifiers(links: string[], usernames: string[]): Identifier[] {
  const seen = new Map<string, Identifier>();
  for (const link of links) {
    const id = canonicalLink(link);
    if (id) seen.set(`${id.type}:${id.canonical}`, id);
  }
  for (const name of usernames) {
    const n = normaliseUsername(name);
    if (n) seen.set(`username:${n}`, { type: 'username', canonical: n });
  }
  return [...seen.values()];
}
