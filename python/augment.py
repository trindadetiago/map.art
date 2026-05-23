"""map.art — mask augmentation for v01/v02 training pairs (Andy Coenen's scheme).

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


def process_pair(pair_id: str) -> list[dict]:
    scene_id, tile_id = pair_id.split('/', 1)
    pair_dir = TRAINING_ROOT / scene_id / tile_id
    src_path = pair_dir / 'source.png'
    tgt_path = pair_dir / 'target.png'
    if not src_path.exists() or not tgt_path.exists():
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
