-- Migration 4 of 5: private evidence buckets (manual 5.6).
-- No policies are created on storage.objects on purpose: with row level security on and no policy, anon and
-- authenticated cannot list, read or write any evidence object. The service role issues short-lived signed URLs.
--   evidence-incoming : signed-upload landing area; the finalize function validates then moves files
--   evidence-original : untouched original plus SHA-256 (chain of custody)
--   evidence-preview  : metadata-stripped copy that admins view (blurred by default in the UI)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('evidence-incoming', 'evidence-incoming', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('evidence-original', 'evidence-original', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('evidence-preview', 'evidence-preview', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
