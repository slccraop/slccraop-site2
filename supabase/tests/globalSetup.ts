import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = join(import.meta.dirname, '..');
let server: EmbeddedPostgres | null = null;
let dataDir = '';

async function run(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function setup() {
  if (process.env.DATABASE_URL) {
    // Real Supabase (local stack): migrations and seed were already applied by `supabase db reset`.
    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
    process.env.TEST_USES_SHIM = 'false';
    return;
  }
  const port = 54329;
  dataDir = join(tmpdir(), `slccraop-pg-${process.pid}`);
  server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    createPostgresUser: typeof process.getuid === 'function' && process.getuid() === 0, // only needed when run as root
    onLog: () => undefined,
    onError: () => undefined,
  });
  await server.initialise();
  await server.start();
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  await run(url, readFileSync(join(root, 'tests', 'shim.sql'), 'utf8'));
  for (const f of readdirSync(join(root, 'migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    await run(url, readFileSync(join(root, 'migrations', f), 'utf8'));
  }
  await run(url, readFileSync(join(root, 'seed.sql'), 'utf8'));
  process.env.TEST_DATABASE_URL = url;
  process.env.TEST_USES_SHIM = 'true';
}

export async function teardown() {
  if (server) await server.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
