"""earthToPixels — mask augmentation for v01/v02 training pairs (Andy Coenen's scheme).

For each kept pair (per `_keep.json`), produces 9 hybrid input variants
that simulate the "infill" scenarios at inference time:
  - 4 single-quadrant infills (TL, TR, BL, BR)
  - 2 vertical-half infills (L, R)
  - 2 horizontal-half infills (T, B)
  - 1 full-image conversion (entire frame is rendered, red border around the perimeter)

The 'full' variant teaches the model how to handle the seed-tile case —
i.e. converting a raw render into pure pixel art when there's no
already-stylized neighbour context to extend from. v01 omitted this and
the model couldn't handle inputs without context; v02 includes it.

Each variant input image is a composite:
  - Stylized region = pixels from `target.png`
  - Rendered region = pixels from `source.png` (the "to-be-filled" part)
  - 1-px red outline = traced around the rendered region's bbox

The training target for every variant is the full `target.png` (the
model must convert the outlined rendered region into pixel art while
preserving the styled context).

Output layout:
  python/training/v01/_augmented/
    {scene_id}/
      {tile_id}/
        half_L.png, half_R.png, half_T.png, half_B.png,
        quad_TL.png, quad_TR.png, quad_BL.png, quad_BR.png
    manifest.csv  # input_path,prompt,target_path

Resumable: variants that already exist on disk are skipped.

Usage:
    python python/augment.py
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from PIL import Image, ImageDraw


def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(10):
        if (cur / 'pnpm-workspace.yaml').exists():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    raise RuntimeError('repo root not found')


REPO_ROOT = find_repo_root(Path(__file__).parent)
TRAINING_ROOT = REPO_ROOT / 'python' / 'training' / 'v01'
KEEP_FILE = TRAINING_ROOT / '_keep.json'
AUGMENTED_ROOT = TRAINING_ROOT / '_augmented'
MANIFEST_PATH = AUGMENTED_ROOT / 'manifest.csv'

# Rare-token style trigger — same family as Andy's `<isometric nyc pixel art>`
# but project-specific so the LoRA's weights bind to a unique token.
PROMPT = (
    'Fill in the outlined section with the missing pixels corresponding to the '
    '<mapart isometric pixel art> style, removing the border and exactly '
    'following the shape/style/structure of the surrounding image.'
)


def variants_for(size: int) -> dict[str, tuple[int, int, int, int]]:
    """Return {variant_name: (x0, y0, x1, y1)} where the box is the RENDERED
    region (everything outside is the stylized target).
    """
    h = size // 2
    return {
        'half_L': (0, 0, h, size),
        'half_R': (h, 0, size, size),
        'half_T': (0, 0, size, h),
        'half_B': (0, h, size, size),
        'quad_TL': (0, 0, h, h),
        'quad_TR': (h, 0, size, h),
        'quad_BL': (0, h, h, size),
        'quad_BR': (h, h, size, size),
        # 'full' covers the seed-tile case: entire image is the rendered
        # region, model converts the whole frame to pixel art. Missing in
        # v01 — added for v02 so we can stylize a tile with no neighbours.
        'full': (0, 0, size, size),
    }


def make_hybrid(
    source: Image.Image,
    target: Image.Image,
    render_box: tuple[int, int, int, int],
) -> Image.Image:
    """Composite the target image with `render_box` replaced by source pixels,
    then trace a 1-px red outline around the box.
    """
    hybrid = target.copy()
    hybrid.paste(source.crop(render_box), render_box[:2])
    draw = ImageDraw.Draw(hybrid)
    # ImageDraw.rectangle's outline is inclusive of both endpoints, so we
    # subtract 1 from the bottom/right to keep the line inside the box edge.
    x0, y0, x1, y1 = render_box
    draw.rectangle((x0, y0, x1 - 1, y1 - 1), outline=(255, 0, 0), width=1)
    return hybrid


def _renderer_source_path(scene_id: str, tile_id: str) -> Path:
    """Translate scene_id (e.g. 'seed42_n50_1779308635275__sample0') and
    tile_id (e.g. 'c-1_r-1') back to the canonical render path under
    `data/renderer/samples/`. Saves keeping a per-pair `source.png` copy.
    """
    run, sample = scene_id.split('__', 1)
    return REPO_ROOT / 'data' / 'renderer' / 'samples' / run / sample / f'{tile_id}.png'


def process_pair(pair_id: str) -> list[dict]:
    scene_id, tile_id = pair_id.split('/', 1)
    pair_dir = TRAINING_ROOT / scene_id / tile_id
    tgt_path = pair_dir / 'target.png'

    # Source: read canonically from `data/renderer/samples/`. The legacy
    # `pair_dir/source.png` copy was removed to save 890 MB; the canonical
    # path is what `meta.json` already records as `src_relpath`.
    src_path = _renderer_source_path(scene_id, tile_id)
    if not src_path.exists():
        return []

    # Target: kept locally for `augment.py` speed, but not committed to git
    # (downloadable from oxen via `pull_targets_from_oxen.py` if missing).
    if not tgt_path.exists():
        return []

    source = Image.open(src_path).convert('RGB')
    target = Image.open(tgt_path).convert('RGB')

    # Source (renderer tile) and target (gpt-image-2 output) should both be
    # 1024×1024 in v01, but handle the mismatch defensively in case old
    # 512² renders sneak in.
    if source.size != target.size:
        source = source.resize(target.size, Image.LANCZOS)
    size = target.size[0]

    out_dir = AUGMENTED_ROOT / scene_id / tile_id
    out_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    for name, box in variants_for(size).items():
        input_path = out_dir / f'{name}.png'
        if not input_path.exists():
            make_hybrid(source, target, box).save(input_path, optimize=True)
        rows.append(
            {
                'input_path': str(input_path.relative_to(REPO_ROOT)),
                'prompt': PROMPT,
                'target_path': str(tgt_path.relative_to(REPO_ROOT)),
            }
        )
    return rows


def main() -> None:
    if not KEEP_FILE.exists():
        raise SystemExit(f'missing {KEEP_FILE} — run python/cull.py first')

    keep = json.loads(KEEP_FILE.read_text())
    kept: list[str] = keep.get('kept', [])
    if not kept:
        raise SystemExit('no kept pairs in _keep.json — nothing to augment')

    # Pre-flight: warn loudly if targets are missing. They live on oxen and
    # need to be pulled before augmentation can produce anything.
    missing_targets = [
        p for p in kept
        if not (TRAINING_ROOT / p.split('/', 1)[0] / p.split('/', 1)[1] / 'target.png').exists()
    ]
    if missing_targets:
        raise SystemExit(
            f'{len(missing_targets)}/{len(kept)} targets missing.\n'
            f'Run: .venv/bin/python python/pull_targets_from_oxen.py'
        )

    print(f'augmenting {len(kept)} kept pairs → {AUGMENTED_ROOT.relative_to(REPO_ROOT)}/')
    AUGMENTED_ROOT.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict] = []
    for i, pair_id in enumerate(kept):
        rows = process_pair(pair_id)
        all_rows.extend(rows)
        if (i + 1) % 10 == 0 or (i + 1) == len(kept):
            print(f'  [{i + 1:>3}/{len(kept)}] {pair_id} → {len(all_rows)} total examples')

    with MANIFEST_PATH.open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['input_path', 'prompt', 'target_path'])
        w.writeheader()
        w.writerows(all_rows)

    print()
    n_variants = len(variants_for(1024))
    print(f'done. {len(all_rows)} training examples ({len(kept)} pairs × {n_variants} variants)')
    print(f'manifest: {MANIFEST_PATH.relative_to(REPO_ROOT)}')


if __name__ == '__main__':
    main()
