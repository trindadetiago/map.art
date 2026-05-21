"""map.art — horizontal flip augmentation for the v01 training set.

Reads python/training/v01/_augmented/manifest.csv, doubles it by adding
a horizontally-flipped version of every non-flip row. For each original
(input, target) pair, this produces a new (input_flip, target_flip)
pair — both images mirrored.

Why flip is safe for our use case: the isometric light direction in the
gpt-image-2 prompt is "top-left", which becomes "top-right" after mirror.
Still a valid isometric lighting choice, and the model only sees the
mirrored consistency between input and target.

Why we don't rotate: 90°/180° rotations would break the isometric camera
convention (would-be-top buildings facing wrong way). Skip.

Output:
  - Same `_augmented/{scene}/{tile}/` directories — flipped variants land
    next to the originals with a `_flip` suffix on the input file.
  - One shared `target_flip.png` per pair, placed inside `_augmented/`
    (so the committed `target.png` under `training/v01/{scene}/{tile}/`
    stays untouched).
  - manifest.csv rewritten with both original and flipped rows
    (dedup by input_path so re-running is idempotent).

Usage:
    python python/flip.py
"""

from __future__ import annotations

import csv
from pathlib import Path

from PIL import Image, ImageOps


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
MANIFEST_PATH = REPO_ROOT / 'python' / 'training' / 'v01' / '_augmented' / 'manifest.csv'


def main() -> None:
    if not MANIFEST_PATH.exists():
        raise SystemExit(f'missing {MANIFEST_PATH} — run python/augment.py first')

    original_rows: list[dict] = list(csv.DictReader(MANIFEST_PATH.open()))
    if not original_rows:
        raise SystemExit('manifest is empty')

    flip_rows: list[dict] = []
    skipped_existing = 0
    generated = 0

    for row in original_rows:
        in_rel = Path(row['input_path'])
        if in_rel.stem.endswith('_flip'):
            continue  # already a flipped row from a prior run

        in_abs = REPO_ROOT / in_rel
        tgt_abs = REPO_ROOT / row['target_path']
        if not in_abs.exists() or not tgt_abs.exists():
            continue

        flip_in_abs = in_abs.with_name(in_abs.stem + '_flip.png')
        # Shared flipped target lives in the augmented pair dir, NOT in the
        # committed training/{scene}/{tile}/ dir. One file per pair.
        flip_tgt_abs = flip_in_abs.parent / 'target_flip.png'

        if not flip_in_abs.exists():
            ImageOps.mirror(Image.open(in_abs)).save(flip_in_abs, optimize=True)
            generated += 1
        else:
            skipped_existing += 1

        if not flip_tgt_abs.exists():
            ImageOps.mirror(Image.open(tgt_abs)).save(flip_tgt_abs, optimize=True)

        flip_rows.append(
            {
                'input_path': str(flip_in_abs.relative_to(REPO_ROOT)),
                'prompt': row['prompt'],
                'target_path': str(flip_tgt_abs.relative_to(REPO_ROOT)),
            }
        )

    # Dedup by input_path so re-running doesn't multiply rows.
    seen: set[str] = set()
    combined: list[dict] = []
    for r in original_rows + flip_rows:
        if r['input_path'] in seen:
            continue
        seen.add(r['input_path'])
        combined.append(r)

    with MANIFEST_PATH.open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['input_path', 'prompt', 'target_path'])
        w.writeheader()
        w.writerows(combined)

    print(f'generated {generated} new flipped images ({skipped_existing} already existed)')
    print(f'manifest: {len(combined)} total rows (was {len(original_rows)})')
    print(f'  → {MANIFEST_PATH.relative_to(REPO_ROOT)}')


if __name__ == '__main__':
    main()
