# Article assets

Curated images for the earthToPixels journey article. Centralised here so the
working tree doesn't drag along multiple copies of the same renders.

## Layout

- `01-raw-renders/` — 6 diverse raw 3D-isometric tile renders, one tile per
  representative sample. The full set of 450 lives in `data/renderer/samples/`;
  these are hand-picked for the article.
- `02-gpt-image-comparison/` — same source image stylised by gpt-image-2 single
  tile, gpt-image-2 stitched 3×3, gpt-image-1.5 stitched 3×3, and a second
  gpt-image-2 stitched run for determinism comparison. Recovered from commit
  `02fea3e` (deleted in `105ba4c` during the v01 cleanup).
- `03-keep-pairs-gpt-image-2/` — 6 (source, target) pairs from the 106 kept
  v01 training pairs, spread across the manifest for visual diversity.

Add as v02 LoRA outputs and algorithm-A stitched comparisons accrue:

- `04-lora-outputs/` — v01 vs v02 LoRA outputs on identical inputs.
- `05-algorithm-a/` — original-vs-generated stitched 3×3 results.

## How to extend

Just copy a PNG into the appropriate subfolder. Filename convention is
`{sample}__{tile}.png` for singles, `{sample}__{tile}/{source,target,...}.png`
for grouped sets.
