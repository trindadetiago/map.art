# @mapart/storage

Blob storage behind a common `Storage` interface.

Backed by S3 — any S3-compatible endpoint, e.g. local MinIO or real AWS (`src/s3.ts`).

`getStorage()` returns a process-wide singleton built from the `S3_*` env vars. All call-sites are async.

- Admin inspector at `/admin/storage` in `apps/web`
- CLI entries: `pnpm mapart storage list|put|get|delete`

Local MinIO (boots from `pnpm run-setup`): API `localhost:9000`, console `localhost:9001`, bucket `mapart`.
