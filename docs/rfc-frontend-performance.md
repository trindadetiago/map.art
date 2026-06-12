# RFC: Frontend Performance Overhaul

**Status:** Draft  
**Date:** 2026-06-11  
**Authors:** Staff Engineer Collective (Rendering, Worker/Pipeline, Frontend/UX, API/Data, isometric-nyc Analysis)

---

## Executive Summary

O frontend do map.art está extremamente lento porque **toda a renderização 3D acontece no browser** — dois `TilesRenderer` independentes baixando tiles 3D do Google (fotogrametria pesada), rodando a 60fps mesmo quando a cena está escondida, com captura sequencial de tiles e delays fixos de 600ms por tile.

O isometric-nyc é rápido porque **não faz nada 3D no browser** — pré-renderiza tudo offline (Python + GPU) e serve imagens estáticas via OpenSeadragon (DZI tiling), carregando apenas ~20 tiles por viewport.

**Solução:** Migrar de "renderização 3D em tempo real no browser" para **"workers pré-renderizam → browser exibe imagens estáticas"**, em 3 fases.

| Fase | Prazo | O que muda | Ganho |
|------|-------|------------|-------|
| **Phase 1**: Quick Wins | 1-2 semanas | Parar rAF ocioso, fix pixel ratio, debounce topology, shared TilesRenderer, memoization | 50-80% redução de CPU/GPU idle |
| **Phase 2**: Worker Pipeline | 3-4 semanas | Workers renderizam e estilizam tiles; browser começa a consumir pré-renderizados | Browser zero 3D para captura |
| **Phase 3**: Full Pre-Rendered | 2-3 meses | DZI viewer, CDN, zero Three.js no browser | Igual isometric-nyc em performance |

---

## 1. Current State: Pain Points

### 1.1 O que está rodando no browser

| Componente | Arquivo | O que faz | Custo |
|---|---|---|---|
| Hidden capture scene | `scene.tsx:82-118` | Cria TilesRenderer + WebGLRenderer próprio, rAF 60fps | GPU/CPU 24/7 |
| Interactive preview map | `project_map.tsx:241-280` | Cria **outro** TilesRenderer + WebGLRenderer, rAF 60fps | Dobra tudo |
| Overlay geometry | `project_map.tsx:368-540` | `rebuildTopology()` recria BufferGeometry inteira a cada slider drag | O(n) GPU buffer uploads por frame |
| Pixel ratio | `scene.tsx:91`, `project_map.tsx:242` | `setPixelRatio(devicePixelRatio)` em tela Retina | 2-3x GPU memory waste |
| Sequential capture | `project_workspace.tsx:369-446` | `waitForSettled(600ms)` por tile + vizinhos | 25 tiles = 15s+ mínimo |
| Stale duplicate | `ProjectWorkspace.tsx` (1118 linhas) | Duplicata não usada, importa de path inexistente | Confusão |

### 1.2 Linha do tempo de uma operação típica

```
Page load:   Server DB query (1-2s) → Hydration → 2× WebGL bootstrap (3-5s) → Tiles stream in (8-20s)
Click tile:  inFlight gate → reorient (rAF) → waitForSettled(600ms) → capture → upload → 
             [repeat for 0-8 neighbours] → buildInfill → OpenAI API (10-45s) → save
Slider drag: setState → React render → rebuildTopology (destroy + allocate) → GPU upload → render
             ↑ repete a cada tick do slider (60x/s)
```

### 1.3 Comparação com isometric-nyc

| Métrica | map.art (atual) | isometric-nyc |
|---------|----------------|---------------|
| Renderização 3D no browser | Sim (2 instâncias) | Zero |
| Tiles baixados por viewport | Milhares (Google 3D Tiles) | ~20 (DZI) |
| Formato de imagem | PNG (150KB/tile) | WebP (40-60KB/tile) |
| GPU usage idle | Alta (rAF contínuo) | Zero |
| Main thread bloqueio | Sim (render, parse, capture) | Não |
| Bundle size | ~500KB (Three.js + TilesRenderer) | ~100KB (OpenSeadragon) |

---

## 2. Target Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  BROWSER (thin client)                                       │
│  ┌─────────────────────┐  ┌──────────────────────────────┐  │
│  │ Project Setup       │  │ Tile Viewer                  │  │
│  │ (2D map, Leaflet)   │  │ (Canvas 2D or OpenSeadragon) │  │
│  │ pick area + params  │  │ imageSmoothingEnabled: false │  │
│  └─────────┬───────────┘  └──────────────┬───────────────┘  │
│            │                              │                  │
│            ▼                              ▼                  │
│  POST /v1/projects/.../generate    GET CDN URL (R2/S3)       │
│            │                              │                  │
└────────────┼──────────────────────────────┼──────────────────┘
             │                              │
      ┌──────▼──────────────────────────────▼──────────┐
      │             Postgres + PostGIS                  │
      │  jobs (queue)  │  tiles (status)  │  projects   │
      └──────┬──────────────────────────────┬──────────┘
             │                              │
    ┌────────▼─────────┐          ┌─────────▼──────────┐
    │  worker-render   │          │  worker-stylize    │
    │  (headless Chromium)        │  (OpenAI / models) │
    │  Three.js + 3D Tiles       │  infill compositing │
    └────────┬─────────┘          └─────────┬──────────┘
             │                              │
             └──────────┬───────────────────┘
                        ▼
             ┌─────────────────────┐
             │  S3 / MinIO / R2    │
             │  (pre-rendered PNG) │
             └─────────────────────┘
```

**Princípios:**
- **Read path:** Browser → CDN → imagem estática. Rápido, cacheável, sem código server.
- **Write path:** Browser → API enfileira job → workers processam → salvam no storage.
- **Workers são os únicos escritores** de blob storage (já planejado no `docs/architecture.html`).

---

## 3. Phase 1: Quick Wins (Week 1-2)

Mudanças que podem ser shipped esta semana, sem alterar arquitetura, usando o código atual.

### 3.1 Parar rAF da Scene escondida quando ociosa

**Arquivo:** `apps/web/components/scene.tsx:111-118`

```diff
+ let needsRender = false;
  const tick = () => {
    if (disposed) return;
+   if (!needsRender) {
+     requestAnimationFrame(tick);
+     return;
+   }
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
- requestAnimationFrame(tick);
+ requestIdleCallback(() => requestAnimationFrame(tick));
```

No `project_workspace.tsx`, envolver captura com `sceneRef.current.startRendering()` / `stopRendering()`.

**Impacto:** ~95% redução de GPU idle (cena só renderiza durante capturas).

### 3.2 Fixar pixelRatio = 1 no renderer de captura

**Arquivo:** `scene.tsx:91`

```diff
- renderer.setPixelRatio(window.devicePixelRatio);
+ renderer.setPixelRatio(1); // Capture always exports at logical size
```

`capture()` já exporta em logical size (`scene.tsx:139-145`), então o HiDPI backing store é puro desperdício.

**Impacto:** 4× redução de GPU fill rate no renderer de captura em telas Retina.

### 3.3 Debounce no rebuildTopology

**Arquivo:** `project_map.tsx:569-574`

```diff
+ let topologyTimer: ReturnType<typeof setTimeout> | null = null;

  function applyView(params: UpdateParams): void {
    const key = topologyKeyOf(params);
    if (key !== topologyKey) {
-     rebuildTopology(params);
-     topologyKey = key;
+     if (topologyTimer) clearTimeout(topologyTimer);
+     topologyTimer = setTimeout(() => {
+       rebuildTopology(params);
+       topologyKey = key;
+     }, 100);
    }
    // Camera updates always apply immediately
    updateFrustum(params);
    positionCamera(params);
  }
```

**Impacto:** Elimina 10-50× rebuilds redundantes durante drag de slider.

### 3.4 Compartilhar TilesRenderer entre Scene e ProjectMap

**Arquivos:** `scene.tsx:98`, `project_map.tsx:252-268`

Extrair a criação do `TilesRenderer` para um contexto compartilhado. Ambos usam a mesma instância, eliminando o download duplicado de tiles 3D.

**Impacto:** 50% redução de bandwidth e memória GPU para dados 3D.

### 3.5 Substituir settle de 600ms por event-driven ready

**Arquivo:** `scene.tsx:150-180`

Em vez de polling com 600ms fixo, usar eventos do TilesRenderer (`load-tile-set`, `load-model`) para detectar quando tiles terminaram de carregar + 1 frame (16ms) de settle.

```diff
  waitForSettled(opts) {
+   if (contentLoaded && tiles.downloadQueue?.running === false) {
+     return Promise.resolve(); // Already settled
+   }
    // fallback: poll at 100ms with 600ms timeout
  }
```

**Impacto:** Captura por tile cai de ~700ms para ~50ms. 25 tiles: 15s → 1.25s.

### 3.6 Memoization fixes

| Arquivo | Problema | Fix |
|---------|----------|-----|
| `project_workspace.tsx:351` | `new Map(m)` em cada `setStatus` | Usar immutable update ou `useRef` |
| `project_workspace.tsx:551-557` | `Array.from(statuses).sort()` em cada render | Mover para `useMemo` com deps corretas |
| `project_map.tsx:142-153` | 4 `useEffect` que só atualizam refs | Substituir por atribuição direta no callback |

### 3.7 Deletar arquivo stale

```bash
git rm apps/web/components/projects/ProjectWorkspace.tsx
```

Duplicata de 1118 linhas, não importada, importa de path inexistente (`@mapart/renderer/debug/Scene`).

### 3.8 Adicionar loading states

- `apps/web/app/projects/[slug]/loading.tsx` — shimmer enquanto DB query roda
- `project_map.tsx` — skeleton enquanto WebGL inicializa
- Suspense boundary no `page.tsx` para o `ProjectWorkspace`

---

## 4. Phase 2: Worker Pipeline (Week 3-4)

### 4.1 Job Queue

Extender a tabela `jobs` existente em `packages/db/src/schema/jobs.ts`:

```sql
ALTER TABLE jobs ADD COLUMN priority     integer NOT NULL DEFAULT 100;
ALTER TABLE jobs ADD COLUMN depends_on   uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN started_at   timestamptz;
ALTER TABLE jobs ADD COLUMN finished_at  timestamptz;
ALTER TABLE jobs ADD COLUMN cost_cents   integer;
ALTER TABLE jobs ADD COLUMN duration_ms  integer;

-- Hot path para worker polling
CREATE INDEX jobs_poll_idx ON jobs (priority ASC, created_at ASC)
  WHERE status = 'pending' AND attempts < max_attempts;

-- Detecção de jobs stuck
CREATE INDEX jobs_stuck_idx ON jobs (claimed_at)
  WHERE status = 'claimed' AND claimed_at < now() - interval '5 minutes';
```

**Job types:**

| Kind | Worker | Input | Output |
|------|--------|-------|--------|
| `render` | worker-render | project params + col/row | `rendered.png` no S3 |
| `generate` | worker-stylize | rendered tile + 8 vizinhos | `generated.png` no S3 |
| `infill` | worker-stylize | 3×3 composite | generated tile (com bordas seamless) |
| `export` | worker-export | all generated tiles | DZI pyramid |

**Claim loop** (já existe base em `packages/db/src/repos/jobs.ts`):

```sql
WITH next_job AS (
  SELECT id FROM jobs
  WHERE status = 'pending' AND kind = 'render'
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs SET status = 'claimed', claimed_by = $workerId, claimed_at = now()
FROM next_job WHERE jobs.id = next_job.id
RETURNING jobs.*;
```

### 4.2 worker-render (headless rendering)

**Estratégia:** Puppeteer + headless Chrome (Option A — menor risco).

```typescript
// apps/worker-render/src/render-tile.ts
import puppeteer from 'puppeteer';

async function renderTile(params: RenderTileParams): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: params.size, height: params.size });

  // Navega para uma página HTML mínima que instancia Three.js + TilesRenderer
  // com os mesmos parâmetros de camera do scene.tsx
  const url = buildRenderUrl(params);
  await page.goto(url, { waitUntil: 'networkidle0' });

  // Espera os tiles 3D carregarem
  await page.waitForFunction('window.TILES_READY === true', { timeout: 30000 });

  // Captura screenshot do canvas
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    return canvas.toDataURL('image/png');
  });

  await browser.close();
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}
```

Reusa exatamente o mesmo código de `packages/renderer` e `scene.tsx` — zero risco de divergência visual.

**Pool de browsers:** Manter 2-4 instâncias warm para evitar cold start de 2s por job.

### 4.3 worker-stylize (AI generation)

```typescript
// apps/worker-stylize/src/generate-tile.ts
async function generateTile(job: GenerateJob): Promise<void> {
  // 1. Busca rendered tile + 8 vizinhos do S3
  const rendered = await storage.get(renderedKey);
  const neighbors = await loadNeighbors(job.col, job.row);

  // 2. Build 3×3 infill composite (igual buildInfillInputs no project_workspace.tsx)
  const { hybrid, mask } = await buildInfillComposite(rendered, neighbors);

  // 3. Call model API (reusa @mapart/models)
  const result = await modelClient.edit({
    image: hybrid,
    mask: mask,
    prompt: job.prompt,
  });

  // 4. Crop + save to S3
  const cropped = cropCenter(result, INFILL_SLOT_SIZE);
  await storage.put(generatedKey, cropped);

  // 5. Update DB
  await createTileVersionAndSetCurrent(job.projectId, job.col, job.row, generatedKey);
}
```

### 4.4 Cache hierarchy

```
L1: worker memory (Map<key, Buffer>) — TTL 5min, ~100 tiles
L2: local disk (worker temp dir) — TTL 1h, ~1000 tiles
L3: S3/MinIO — permanente, versionado
```

**Storage key schema:**

```
projects/{projectId}/
  render/v{timestamp}/{col}_{row}.png
  generated/v{timestamp}/{col}_{row}.png
  infill/v{timestamp}/{col}_{row}/
    hybrid.png
    mask.png
    result.png
```

### 4.5 Browser changes

Após workers estarem rodando:

1. **Preview map:** Remover `TilesRenderer` do `project_map.tsx` — manter apenas overlay de wireframe + cores de estado. Zero download de tiles 3D.
2. **Capture:** Browser não captura mais. Clicar "Render" cria job no Postgres. UI faz poll de status.
3. **Display:** Imagens carregadas via `<img>` com URL direta do S3 (não mais proxy via `/api/storage`).

---

## 5. Phase 3: Full Pre-Rendered Model (Month 2-3)

### 5.1 OpenSeadragon DZI Viewer

**Configuração (baseada no isometric-nyc):**

```typescript
const viewer = OpenSeadragon({
  showNavigationControl: false,
  animationTime: 0.15,
  blendTime: 0.1,
  imageSmoothingEnabled: false,          // CRÍTICO para pixel art
  subPixelRoundingForTransparency: 1,    // Evita anti-aliasing
  visibilityRatio: 0.2,
  constrainDuringPan: false,
  minZoomImageRatio: 1,
  maxZoomPixelRatio: 1,
  gestureSettingsMouse: {
    scrollToZoom: true,
    clickToZoom: false,
    dblClickToZoom: true,
  },
  tileSources: {
    getTileUrl: (level, x, y) =>
      `${dziBase}/${level - levelOffset}/${x}_${y}.webp`,
  },
});
```

### 5.2 DZI Export Pipeline

```typescript
// packages/pipeline/src/export-dzi.ts
import sharp from 'sharp';

async function exportDZI(projectId: string): Promise<void> {
  // 1. Load all generated tiles from S3
  // 2. Stitch into composite canvas
  // 3. Export DZI pyramid with sharp
  await sharp(compositeBuffer)
    .tile({
      size: 512,
      layout: 'dz',
      overlap: 0,
      background: { r: 0, g: 0, b: 0 },
    })
    .webp({ quality: 95 })
    .toFile(outputDir);
}
```

**ATENÇÃO:** sharp's `tile()` usa bilinear para níveis da pirâmide. Para pixel art, fazer downscale manual com `kernel: 'nearest'`:

```typescript
// Downscale each level with nearest-neighbor
for (let level = 1; level <= maxLevel; level++) {
  const scale = 1 / (2 ** level);
  await sharp(fullResBuffer)
    .resize({ width: Math.floor(fullWidth * scale), kernel: 'nearest' })
    .webp({ quality: 95 })
    .toFile(`${outputDir}/${level}/`);
}
```

### 5.3 WebP em tudo

Substituir PNG por WebP lossless no pipeline:

```diff
// project_workspace.tsx:54-58
- canvas.toBlob((b) => ..., 'image/png');
+ canvas.toBlob((b) => ..., 'image/webp', 1.0);
```

**Impacto:** 50-70% redução de bandwidth (512×512 pixel art PNG ~150KB → WebP ~40-60KB).

### 5.4 CDN Delivery

- **Dev:** MinIO local (já existe)
- **Staging:** Cloudflare R2 (S3-compatible, zero egress fees, CDN built-in)
- **Production:** R2 + custom domain (`cdn.map.art`)

Cache headers nos tiles:

```
Cache-Control: public, max-age=31536000, immutable
ETag: "{sha256}"
```

Invalidação: quando tile é regenerado, `current_version_id` muda → purge na URL específica (R2 suporta purge instantâneo).

### 5.5 Zero Three.js no browser

No final da Phase 3:

- `apps/web` não importa mais `three`, `3d-tiles-renderer`, `@mapart/renderer`
- Bundle size cai ~500KB
- Zero WebGL contexts no browser
- Browser é um visualizador de imagens 2D (Canvas ou OpenSeadragon)

---

## 6. Trade-offs & Riscos

| Decisão | Ganho | Perda / Risco |
|---------|-------|---------------|
| Remover TilesRenderer do preview map | Preview fica instantâneo | Sem preview 3D fotorrealista — só wireframe + cores |
| Puppeteer p/ render headless | Reusa 100% do código existente | ~300MB RAM por worker; 2s cold start |
| `gl` (headless-gl) em vez de Puppeteer | Mais leve (~50MB) | `3d-tiles-renderer` pode quebrar sem APIs de browser |
| Worker queue async | Escalável, retryable | Usuário espera 5-30s em vez de ver resultado "instantâneo" |
| Full pre-render (Phase 3) | Performance máxima | Perde preview 3D interativo — precisa de novo fluxo de setup |
| WebP em vez de PNG | 50-70% menos bandwidth | Suporte a WebP é 97%+ (aceitável) |
| DZI tiling | Só carrega ~20 tiles/viewport | Complexidade de export; geração da pirâmide leva tempo |

**Mitigação de riscos:**
- Feature flag `ENABLE_3D_PREVIEW` para manter preview 3D durante transição
- Pipeline async com SSE para progresso em tempo real (já existe em `api/jobs/[id]/progress/route.ts`)
- Google API key fica server-side (workers) — melhora segurança
- Testar `gl` em paralelo com Puppeteer; migrar se viável

---

## 7. Implementation Sequence

```
Week 1-2: Quick Wins
  ├── Day 1-2: Stop rAF ocioso (scene.tsx)
  ├── Day 2:   Fix pixelRatio = 1 (scene.tsx)
  ├── Day 2-3: Debounce rebuildTopology (project_map.tsx)
  ├── Day 3-4: Memoization fixes (project_workspace.tsx)
  ├── Day 4:   Delete stale ProjectWorkspace.tsx
  ├── Day 4-5: Loading states (loading.tsx, skeleton)
  └── Day 5-6: Replace 600ms settle with event-driven

Week 2-3: Worker Foundation
  ├── Day 1-2: Extend jobs table (priority, depends_on, indexes)
  ├── Day 3-4: Implement claimJob/completeJob/failJob
  ├── Day 5-6: worker-stylize (move generateTileAction logic to worker)
  └── Day 7:   Basic SSE progress polling

Week 3-4: Headless Rendering
  ├── Day 1-3: worker-render with Puppeteer
  ├── Day 4-5: Shared TilesRenderer refactor
  ├── Day 6:   Integrate worker-render with job queue
  └── Day 7:   Browser consumes worker-rendered tiles

Week 4-6: API & Storage
  ├── Week 1:  Tile serving API (/v1/tiles/...)
  ├── Week 1:  listTilesWithStatus() DB query
  ├── Week 2:  Direct S3 URLs (remove API proxy for images)
  └── Week 2:  CDN caching headers

Week 6-10: Full Pre-Rendered
  ├── Week 1-2: DZI export pipeline (sharp)
  ├── Week 2-3: OpenSeadragon viewer integration
  ├── Week 3-4: Remove Three.js from browser
  ├── Week 4:   WebP migration
  └── Week 4-5: Cloudflare R2 production setup
```

---

## Appendix A: Key Files Reference

| Arquivo | Linhas | Função | Mudança |
|---------|--------|--------|---------|
| `scene.tsx` | 191 | Hidden capture scene | rAF on-demand, pixelRatio=1 |
| `project_map.tsx` | 924 | Interactive 3D map | Debounce topology, shared TilesRenderer |
| `project_workspace.tsx` | 932 | Workspace + capture pipeline | Memoization, dynamic imports |
| `ProjectWorkspace.tsx` | 1118 | **STALE** — deletar | `git rm` |
| `page.tsx` (projects) | 444 | Server component | Suspense, loading.tsx |
| `packages/renderer/src/tiles.ts` | 53 | TilesRenderer factory | Reusado por worker-render |
| `packages/renderer/src/camera.ts` | 47 | Camera math | Reusado por worker-render |
| `packages/shared/src/types.ts` | 139 | Tile coordinate math | Reusado por worker-render |
| `packages/db/src/schema/jobs.ts` | — | Job queue schema | +priority, +depends_on, +indexes |
| `packages/storage/src/` | — | Storage interface | +presignReadUrl() |

## Appendix B: Decisions Log

| Decisão | Escolha | Alternativa rejeitada | Razão |
|---------|---------|----------------------|-------|
| Headless rendering engine | Puppeteer + Chrome | `gl` (headless-gl) | Menor risco, reusa código existente |
| Image format | WebP lossless | PNG, AVIF | Melhor compressão, suporte 97%+ |
| Tile viewer (Phase 3) | OpenSeadragon | Canvas 2D custom | Battle-tested, DZI nativo, caching built-in |
| Worker scaling | Horizontal (mais workers) | Vertical (worker mais rápido) | Tiles são independentes, paralelizáveis |
| CDN | Cloudflare R2 | CloudFront + S3 | Zero egress fees, S3-compatible, purge instantâneo |
| Job queue | Postgres SKIP LOCKED | Redis/BullMQ | Sem dependência extra, já temos Postgres |
