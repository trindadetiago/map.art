"""map.art — bundle the v01 augmented dataset into a self-contained
folder ready for oxen.ai upload.

Reads python/training/v01/_augmented/manifest.csv, hard-links every
referenced input and target into a flat `images/` directory under
`_oxen_upload/`, and writes a new manifest whose paths are relative
to the bundle root.

Why hard links instead of copies: 1696 inputs + 212 targets is ~3GB.
Hard links are instant and take zero extra disk on the same volume.
Pass --copy to force real copies if you need to move the bundle to
another filesystem (cloud sync, USB stick, etc).

Output layout:
    python/training/v01/_oxen_upload/
        manifest.csv          # input,prompt,target — paths relative to here
        images/
            {scene}__{tile}__{variant}.png       # 1696 input PNGs
            {scene}__{tile}__target.png          # ~106 unique targets
            {scene}__{tile}__target_flip.png     # ~106 flipped targets

Then upload from inside the bundle (e.g. oxen CLI):
    cd python/training/v01/_oxen_upload
    oxen init && oxen add . && oxen commit -m "v01"

Usage:
    python python/bundle_for_oxen.py [--copy]
"""

from __future__ import annotations

import argparse
import csv
import os
import shutil
import sys
from pathlib import Path


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
SRC_MANIFEST = REPO_ROOT / 'python' / 'training' / 'v01' / '_augmented' / 'manifest.csv'
BUNDLE_ROOT = REPO_ROOT / 'python' / 'training' / 'v01' / '_oxen_upload'
IMAGES_DIR = BUNDLE_ROOT / 'images'
BUNDLE_MANIFEST = BUNDLE_ROOT / 'manifest.csv'


def flat_name(rel_path: str) -> str:
    """Convert `python/training/v01/_augmented/{scene}/{tile}/{variant}.png` to
    a unique, flat filename like `{scene}__{tile}__{variant}.png`.
    Works for both input and target paths.
    """
    p = Path(rel_path)
    parts = p.parts
    # Find the index of the segment right after 'v01' (skip leading dirs and
    # the optional '_augmented'). Take {scene}/{tile}/{file} from there.
    try:
        v = parts.index('v01')
    except ValueError as e:
        raise ValueError(f'unexpected path layout: {rel_path}') from e
    tail = list(parts[v + 1 :])
    if tail and tail[0].startswith('_'):  # drop '_augmented'
        tail = tail[1:]
    # tail is now [scene_id, tile_id, filename] for inputs and most targets,
    # or just [scene_id, tile_id, 'target.png'] for unflipped targets.
    if len(tail) != 3:
        raise ValueError(f'unexpected segment count for {rel_path}: {tail}')
    scene, tile, name = tail
    return f'{scene}__{tile}__{name}'


def materialize(src: Path, dst: Path, *, copy: bool) -> None:
    if dst.exists():
        return  # already linked/copied from a previous run
    dst.parent.mkdir(parents=True, exist_ok=True)
    if copy:
        shutil.copy2(src, dst)
        return
    try:
        os.link(src, dst)
    except OSError:
        # Cross-device link or filesystem doesn't support it — fall back.
        shutil.copy2(src, dst)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        '--copy',
        action='store_true',
        help='copy files instead of hard-linking (use for cross-filesystem bundles)',
    )
    args = ap.parse_args()

    if not SRC_MANIFEST.exists():
        sys.exit(f'missing {SRC_MANIFEST} — run python/augment.py + python/flip.py first')

    rows: list[dict[str, str]] = list(csv.DictReader(SRC_MANIFEST.open()))
    if not rows:
        sys.exit('source manifest is empty')

    BUNDLE_ROOT.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    new_rows: list[dict[str, str]] = []
    seen_targets: set[str] = set()
    n_inputs_linked = 0
    n_targets_linked = 0

    for r in rows:
        in_src = REPO_ROOT / r['input_path']
        tgt_src = REPO_ROOT / r['target_path']
        if not in_src.exists() or not tgt_src.exists():
            print(f'  skip (missing): {r["input_path"]}', file=sys.stderr)
            continue

        in_flat = flat_name(r['input_path'])
        tgt_flat = flat_name(r['target_path'])

        materialize(in_src, IMAGES_DIR / in_flat, copy=args.copy)
        n_inputs_linked += 1

        if tgt_flat not in seen_targets:
            materialize(tgt_src, IMAGES_DIR / tgt_flat, copy=args.copy)
            seen_targets.add(tgt_flat)
            n_targets_linked += 1

        new_rows.append(
            {
                'input': f'images/{in_flat}',
                'prompt': r['prompt'],
                'target': f'images/{tgt_flat}',
            }
        )

    with BUNDLE_MANIFEST.open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['input', 'prompt', 'target'])
        w.writeheader()
        w.writerows(new_rows)

    bundle_size_mb = sum(
        (IMAGES_DIR / fn).stat().st_size for fn in os.listdir(IMAGES_DIR)
    ) / (1024 * 1024)
    method = 'copied' if args.copy else 'hard-linked'

    print(f'bundle ready: {BUNDLE_ROOT.relative_to(REPO_ROOT)}/')
    print(f'  manifest  : {len(new_rows)} rows  → manifest.csv')
    print(f'  inputs    : {n_inputs_linked} {method}')
    print(f'  targets   : {n_targets_linked} unique {method}')
    print(f'  size      : {bundle_size_mb:,.0f} MiB (logical; hard links cost 0 disk)')


if __name__ == '__main__':
    main()
