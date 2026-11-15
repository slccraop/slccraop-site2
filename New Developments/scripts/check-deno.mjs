// Type-checks every Edge Function with Deno, the way Supabase will run it. Needs Deno installed (https://deno.com).
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const probe = spawnSync('deno', ['--version'], { encoding: 'utf8' });
if (probe.error) {
  console.error(
    'Deno is not installed, so the Edge Functions were not type-checked. Install it from https://deno.com and run again.',
  );
  process.exit(process.argv.includes('--require') ? 1 : 0);
}
let failed = 0;
for (const name of readdirSync('supabase/functions')) {
  const entry = `supabase/functions/${name}/index.ts`;
  if (name.startsWith('_') || !existsSync(entry)) continue;
  const r = spawnSync('deno', ['check', '--config', `supabase/functions/${name}/deno.json`, entry], {
    stdio: 'inherit',
  });
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${name}`);
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
