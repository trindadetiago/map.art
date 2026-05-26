# @mapart/env

Typed env loader.

- Reads `.env` (idempotent; populates `process.env`)
- Validates values via per-key validators
- Exposes `env` (typed) and `requireEnv(key)` for call-site enforcement
- Schema lives in `src/schema.ts`
- Admin inspector at `/admin/env` in `apps/web`
