import { defineConfig } from 'vitest/config';

// Database tests: npm run test:db
// Without DATABASE_URL they run on a throwaway local Postgres (with supabase/tests/shim.sql standing in for Supabase).
// With DATABASE_URL (for example the local Supabase stack after `supabase db reset`) they run against that database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    globalSetup: ['supabase/tests/globalSetup.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
