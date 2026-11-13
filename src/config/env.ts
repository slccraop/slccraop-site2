const clean = (value: string | undefined): string => (value ?? '').trim();

export const env = {
  supabaseUrl: clean(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, ''),
  anonKey: clean(import.meta.env.VITE_SUPABASE_ANON_KEY),
  turnstileSiteKey: clean(import.meta.env.VITE_TURNSTILE_SITE_KEY),
};

/**
 * True only in `npm run dev` or the `npm run build:sample` preview, and only with no Supabase URL set.
 * A normal `npm run build` (mode production) can never use sample data, and scripts/check-no-fake.mjs proves it.
 */
export const isFakeData: boolean =
  (import.meta.env.DEV || import.meta.env.MODE === 'sample') && env.supabaseUrl === '';
