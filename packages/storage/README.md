# @mapart/storage

Blob storage behind a common `Storage` interface.

Two backends, selected at runtime by `STORAGE_BACKEND`:

- `local` — `<repo>/data/` on disk (`src/local-fs.ts`)
- `s3` — any S3-compatible endpoint, e.g. local MinIO or real AWS (`src/s3.ts`)

`getStorage()` returns a process-wide singleton picked from env. All call-sites are async and identical regardless of backend.

- Admin inspector at `/admin/storage` in `apps/web`
- CLI entries: `pnpm mapart storage list|put|get|delete`

Local MinIO (boots from `pnpm run-setup`): API `localhost:9000`, console `localhost:9001`, bucket `mapart`.
