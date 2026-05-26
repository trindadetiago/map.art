# @mapart/pipeline

Research harness for generation strategies: turn a grid of rendered tiles into a grid of stylized tiles.

This is where we find out how to produce N stylized PNGs that tile seamlessly when stitched, given N rendered inputs. Each candidate approach (independent, infill, big-render, color-normalize, etc.) lives as a strategy module implementing a single interface.

## Strategies today

| Name | Status | Idea |
|---|---|---|
| `independent` | ✅ baseline | Each tile generated as a standalone call; seams ignored |
| `infill` | ☐ TODO | Provide already-generated neighbor pixels + mask over target region |
| `big-render` | ☐ TODO | Render `k×k` tiles as one larger image, generate once, crop |

## Strategy interface

```ts
interface GenerationStrategy {
  name: string;
  description: string;
  run(input: StrategyInput, model: ModelClient): Promise<PipelineTileOutput[]>;
}
```

Add a new strategy = new file under `src/strategies/`, register in `strategies/index.ts`.

## Admin UI

Mounted at `/admin/pipeline` in `apps/web`. Two-phase workflow:

1. **Source prep** — pick a project + tile set, render each tile via the renderer's Scene component. Outputs saved to storage at `pipeline/{projectId}/rendered/{col}_{row}.png`.
2. **Experiments** — load the rendered tiles, run a chosen strategy, save outputs to `pipeline/{projectId}/generated/{strategyName}/{col}_{row}.png`. Display stitched output with optional seam overlay.

Phase 1 outputs are reusable — changing a strategy doesn't re-render; it only re-runs the model calls on the existing rendered set.
