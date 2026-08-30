"""earthToPixels — re-download stylized targets from oxen.ai.

The 106 kept (source, target) pairs' `target.png` files are not stored
in this repo to save ~300 MB. They're hosted publicly on the oxen
dataset at `images/{scene_id}__{tile_id}__target.png`. This script
pulls every missing target back into `python/training/v01/{scene}/{tile}/`
so `augment.py` can be re-run.

Usage:
    .venv/bin/python python/pull_targets_from_oxen.py
"""

from __future__ import annotations

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from dotenv import load_dotenv

NAMESPACE = 'trindadetiago'
REPO_NAME = 'mapart-isometric-v01'
HOST = 'hub.oxen.ai'
BRANCH = 'main'
MAX_PARALLEL = 8


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


def oxen_target_url(pair_id: str) -> str:
    """Map a pair_id like 'seed42_n50_..__sample0/c-1_r-1' to the
    public oxen URL of its target.png."""
    scene, tile = pair_id.split('/', 1)
    flat = f'{scene}__{tile}__target.png'
    return f'https://{HOST}/api/repos/{NAMESPACE}/{REPO_NAME}/file/{BRANCH}/images/{flat}'


def download(pair_id: str, token: str) -> tuple[str, str | None]:
    """Returns (pair_id, error_or_none)."""
    scene, tile = pair_id.split('/', 1)
    dst = TRAINING_ROOT / scene / tile / 'target.png'
    if dst.exists():
        return pair_id, None  # already present
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        r = requests.get(
            oxen_target_url(pair_id),
            headers={'Authorization': f'Bearer {token}'} if token else {},
            timeout=60,
        )
        if r.status_code != 200:
            return pair_id, f'HTTP {r.status_code}'
        dst.write_bytes(r.content)
        return pair_id, None
    except Exception as e:  # noqa: BLE001
        return pair_id, f'{type(e).__name__}: {e}'


def main() -> None:
    if not KEEP_FILE.exists():
        sys.exit(f'missing {KEEP_FILE}')
    load_dotenv(REPO_ROOT / '.env')
    token = os.environ.get('OXEN_API_KEY', '')
    if not token:
        print('warning: OXEN_API_KEY not set — will try anonymous fetches', file=sys.stderr)

    keep = json.loads(KEEP_FILE.read_text())
    kept: list[str] = keep.get('kept', [])
    print(f'{len(kept)} kept pairs to check')

    missing = [
        p for p in kept
        if not (TRAINING_ROOT / p.split('/', 1)[0] / p.split('/', 1)[1] / 'target.png').exists()
    ]
    if not missing:
        print('all targets already present')
        return

    print(f'{len(missing)} targets missing — downloading with {MAX_PARALLEL} workers')
    failures: list[tuple[str, str]] = []
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as ex:
        futures = {ex.submit(download, p, token): p for p in missing}
        for n, fut in enumerate(as_completed(futures), 1):
            pid, err = fut.result()
            if err:
                failures.append((pid, err))
                print(f'  [{n}/{len(missing)}] FAIL {pid}: {err}')
            elif n % 25 == 0 or n == len(missing):
                print(f'  [{n}/{len(missing)}] ok')

    print()
    print(f'done. {len(missing) - len(failures)} succeeded, {len(failures)} failed.')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
