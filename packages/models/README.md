# @mapart/models

Image-edit model clients behind a common `ModelClient` interface.

- `gpt-image-1.5` — OpenAI gpt-image-1.5 via `/v1/images/edits` (masked edits supported)
- `gpt-image-2` — OpenAI gpt-image-2 via `/v1/images/edits` (masked edits supported)
- Factory: `getModel(name, opts)` — requires `opts.apiKey` (OpenAI key)
- Admin inspector at `/admin/models` in `apps/web`
- CLI entry: `pnpm mapart models generate --input … --prompt … --out …`
