"""map.art — push the v01 oxen-upload bundle to hub.oxen.ai.

What this script does, in order:
  1. Verify the `oxen` CLI is installed and OXEN_API_KEY is in .env.
  2. Configure CLI auth for hub.oxen.ai.
  3. Initialise the bundle dir as an oxen repo (if not already).
  4. Create the remote repo `trindadetiago/mapart-isometric-v01` on
     hub.oxen.ai (idempotent — succeeds if it already exists).
  5. `oxen add` the manifest + images, `oxen commit`, `oxen push`.

The training step (kicking off the actual Qwen Image Edit fine-tune)
is **not** automated here. Oxen's training trigger is typically driven
from their web UI; after this script finishes, go to
https://hub.oxen.ai/trindadetiago/mapart-isometric-v01 and start the
fine-tune from there.

Setup (one-time):
    pip install oxenai
    # then put OXEN_API_KEY=<your token> in .env

Usage:
    python python/upload_to_oxen.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

# --- config --------------------------------------------------------------
NAMESPACE = 'trindadetiago'
REPO_NAME = 'mapart-isometric-v01'
HOST = 'hub.oxen.ai'
BRANCH = 'main'
COMMIT_MSG = 'v01 training set — 1696 examples (106 kept pairs × 8 variants × 2 flips)'
# -------------------------------------------------------------------------


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
BUNDLE = REPO_ROOT / 'python' / 'training' / 'v01' / '_oxen_upload'
MANIFEST = BUNDLE / 'manifest.csv'
FULL_REPO = f'{NAMESPACE}/{REPO_NAME}'


def run(cmd: list[str], *, cwd: Path | None = None, allow_fail: bool = False) -> str:
    print(f'$ {" ".join(cmd)}{f"   (cwd={cwd.relative_to(REPO_ROOT)})" if cwd else ""}')
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    if out.strip():
        for line in out.splitlines():
            print(f'  {line}')
    if r.returncode != 0 and not allow_fail:
        sys.exit(f'failed (exit {r.returncode}): {" ".join(cmd)}')
    return out


def main() -> None:
    # 1. Preflight checks
    if shutil.which('oxen') is None:
        sys.exit('oxen CLI not found. Install with: pip install oxenai')

    load_dotenv(REPO_ROOT / '.env')
    token = os.environ.get('OXEN_API_KEY')
    if not token:
        sys.exit('OXEN_API_KEY not set in .env (get one at https://hub.oxen.ai/settings)')

    if not MANIFEST.exists():
        sys.exit(f'bundle missing: {MANIFEST} — run python/bundle_for_oxen.py first')

    print(f'bundle: {BUNDLE.relative_to(REPO_ROOT)}')
    print(f'remote: {HOST}/{FULL_REPO}')
    print()

    # 2. Configure CLI auth
    run(['oxen', 'config', '--auth', HOST, token])

    # 3. Init bundle dir as an oxen repo (idempotent)
    if not (BUNDLE / '.oxen').exists():
        run(['oxen', 'init'], cwd=BUNDLE)
    else:
        print('  (.oxen already exists — skipping init)')

    # 4. Create remote repo (idempotent — okay if it already exists)
    print()
    print('creating remote repo (ok to fail if it already exists):')
    run(
        ['oxen', 'create-remote', '--name', FULL_REPO, '--host', HOST],
        allow_fail=True,
    )

    # Wire the remote regardless — setting it twice is harmless.
    remote_url = f'https://{HOST}/{FULL_REPO}'
    run(['oxen', 'config', '--set-remote', 'origin', remote_url], cwd=BUNDLE)

    # 5. Stage, commit, push
    print()
    run(['oxen', 'add', '.'], cwd=BUNDLE)
    run(['oxen', 'commit', '-m', COMMIT_MSG], cwd=BUNDLE, allow_fail=True)
    run(['oxen', 'push', 'origin', BRANCH], cwd=BUNDLE)

    print()
    print('✓ done — bundle pushed to oxen.ai')
    print(f'  https://hub.oxen.ai/{FULL_REPO}')
    print()
    print('next: open that page in your browser and kick off the Qwen Image')
    print('      Edit fine-tune from the oxen.ai UI. Point it at manifest.csv.')


if __name__ == '__main__':
    main()
