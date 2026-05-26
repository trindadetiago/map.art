# @mapart/models

Image-edit model clients behind a common `ModelClient` interface.

- `stub` — deterministic local stub for offline development
- `nano-banana` — Google Gemini 2.5 Flash Image
- `openai` — gpt-image-1
- Factory: `getModel(name, opts)`
- Admin inspector at `/admin/models` in `apps/web`
- CLI entry: `pnpm mapart models generate --input … --prompt … --out …`
