import { testDbTarget } from './_test-db-url';

// Runs in each test worker BEFORE any module imports @mapart/env. Pointing
// DATABASE_URL at the isolated test database here means @mapart/env (whose
// loader only fills unset keys) builds `env` against the test DB — so the
// suite's delete(tiles)/delete(projects) wipes never touch dev data.
process.env.DATABASE_URL = testDbTarget().url;
