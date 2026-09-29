/**
 * Runs before every test file (vitest.config.mts → setupFiles).
 *
 * Tests must never reach the app's real database. db() reads DATABASE_URL only when no pool
 * has been injected, so remove it from the test process entirely; the value is kept (not
 * exported) so the database harness can refuse a DATABASE_URL_TEST that points at it.
 */
const g = globalThis as { __appDatabaseUrl?: string };
g.__appDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
