"""earthToPixels — push the v01 oxen-upload bundle to hub.oxen.ai via the
oxen Python SDK (no CLI required).

What this script does, in order:
  1. Verify the `oxen` SDK is installed and OXEN_API_KEY is in .env.
  2. Configure SDK auth + user (one-time, idempotent).
  3. Create the remote repo `trindadetiago/mapart-isometric-v01` if it
     doesn't already exist.
  4. Stage every file in python/training/v01/_oxen_upload/ into a
     workspace and commit it to the `main` branch.

The training step (kicking off the actual Qwen Image Edit fine-tune)
is **not** automated — oxen.ai's training trigger is driven from their
web UI. After this finishes, open the repo URL printed at the end and
start the fine-tune from there, pointing it at `manifest.csv`.

Setup (one-time):
    .venv/bin/pip install oxenai
    # then add OXEN_API_KEY=<your token> to .env

Usage:
    .venv/bin/python python/upload_to_oxen.py
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

# --- config --------------------------------------------------------------
NAMESPACE = 'trindadetiago'
REPO_NAME = 'mapart-isometric-v01'
HOST = 'hub.oxen.ai'
BRANCH = 'main'
COMMIT_MSG = 'v01 training set — 1696 examples (106 kept pairs × 8 variants × 2 flips)'
IS_PUBLIC = False
WORKSPACE_NAME = 'upload-v01'
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
IMAGES_DIR = BUNDLE / 'images'
FULL_REPO = f'{NAMESPACE}/{REPO_NAME}'


def git_identity() -> tuple[str, str]:
    """Best-effort git user.name + user.email for the oxen user config."""
    try:
        name = subprocess.check_output(['git', 'config', 'user.name'], text=True).strip()
        email = subprocess.check_output(['git', 'config', 'user.email'], text=True).strip()
    except Exception:
        name, email = NAMESPACE, f'{NAMESPACE}@users.noreply.oxen.ai'
    return name or NAMESPACE, email or f'{NAMESPACE}@users.noreply.oxen.ai'


def main() -> None:
    # 1. Preflight
    try:
        import oxen  # noqa: F401
        from oxen import RemoteRepo
        from oxen.auth import config_auth
        from oxen.user import config_user
    except ImportError:
        sys.exit('oxen SDK not installed. Run: .venv/bin/pip install oxenai')

    load_dotenv(REPO_ROOT / '.env')
    token = os.environ.get('OXEN_API_KEY')
    if not token:
        sys.exit('OXEN_API_KEY not set in .env (get one at https://hub.oxen.ai/settings)')

    if not MANIFEST.exists() or not IMAGES_DIR.is_dir():
        sys.exit(f'bundle missing: {BUNDLE} — run python/bundle_for_oxen.py first')

    # 2. Configure auth + user (idempotent — overwrites the local config file)
    print(f'configuring oxen auth for {HOST}')
    config_auth(token=token, host=HOST)
    name, email = git_identity()
    print(f'configuring oxen user: {name} <{email}>')
    config_user(name=name, email=email)

    # 3. Ensure remote repo exists
    repo = RemoteRepo(repo_id=FULL_REPO, host=HOST, revision=BRANCH)
    if repo.exists():
        print(f'remote repo already exists: {HOST}/{FULL_REPO}')
    else:
        print(f'creating remote repo: {HOST}/{FULL_REPO} (public={IS_PUBLIC})')
        # `empty=False` seeds an initial commit on `main` so that workspaces
        # (needed by `repo.add`) can be created. An empty branch has no head
        # commit, which makes the workspace API fail with
        # `:no_commits_on_branch`.
        repo.create(empty=False, is_public=IS_PUBLIC)

    # 4. Stage every file in the bundle.
    # First, clear any stale workspace from a previous failed run so we don't
    # accumulate cruft. delete_workspace is no-op if it doesn't exist.
    try:
        repo.delete_workspace(WORKSPACE_NAME)
        print(f'cleared stale workspace `{WORKSPACE_NAME}`')
    except Exception:  # noqa: BLE001 — workspace not existing throws; that's fine
        pass

    # Build set of files already on remote so we can skip them on incremental
    # re-runs. `repo.ls()` paginates at 100 entries per page max — earlier
    # version of this code missed that and only checked the first 100,
    # causing thousands of redundant uploads. Always page through to EOF.
    # The manifest is ALWAYS re-uploaded because its contents change per run.
    existing_remote: set[str] = set()
    try:
        page = 1
        page_size = 100  # max per oxen SDK
        while True:
            entries = repo.ls('images', page_num=page, page_size=page_size)
            if not entries:
                break
            for entry in entries:
                name = entry if isinstance(entry, str) else getattr(entry, 'name', str(entry))
                existing_remote.add(name)
            if len(entries) < page_size:
                break
            page += 1
        print(f'remote `images/` already has {len(existing_remote)} files (will skip these)')
    except Exception as exc:  # noqa: BLE001
        print(f'  ls of remote `images/` failed ({exc}) — uploading everything')

    files: list[tuple[Path, str]] = []  # (local_abs_path, dst_dir_in_repo)
    files.append((MANIFEST, ''))  # root — always re-uploaded
    skipped = 0
    for img in sorted(IMAGES_DIR.iterdir()):
        if not img.is_file():
            continue
        if img.name in existing_remote:
            skipped += 1
            continue
        files.append((img, 'images'))
    if skipped:
        print(f'  skipping {skipped} files already on remote')

    print()
    print(f'staging {len(files)} files into workspace `{WORKSPACE_NAME}`', flush=True)
    start = time.time()
    failures: list[tuple[str, str]] = []  # (path, last_error)

    def add_with_retry(path: Path, dst: str, *, max_attempts: int = 5) -> str | None:
        """Returns None on success, or the last error string on giving up."""
        delay = 2.0
        last_err = ''
        for attempt in range(1, max_attempts + 1):
            try:
                repo.add(str(path), dst=dst, branch=BRANCH, workspace_name=WORKSPACE_NAME)
                return None
            except Exception as e:  # noqa: BLE001 — oxen wraps every network error in ValueError
                last_err = f'{type(e).__name__}: {e}'
                if attempt < max_attempts:
                    time.sleep(delay)
                    delay = min(delay * 2, 30.0)  # exponential backoff, cap 30s
        return last_err

    for i, (path, dst) in enumerate(files, 1):
        err = add_with_retry(path, dst)
        if err is not None:
            failures.append((str(path), err))
            print(f'  ! FAILED after retries: {path.name}  ({err})', flush=True)
        if i % 50 == 0 or i == len(files):
            elapsed = time.time() - start
            rate = i / elapsed if elapsed > 0 else 0
            eta = (len(files) - i) / rate if rate > 0 else 0
            ok = i - len(failures)
            print(
                f'  [{i:>4}/{len(files)}] ok={ok} fail={len(failures)}  '
                f'rate {rate:.1f}/s  ETA {eta / 60:.1f}min',
                flush=True,
            )

    if failures:
        print()
        print(f'⚠ {len(failures)} file(s) failed after retries — re-run the script to retry them')
        for p, e in failures[:10]:
            print(f'  - {p}')
            print(f'      {e}')
        if len(failures) > 10:
            print(f'  ... and {len(failures) - 10} more')
        if len(failures) == len(files):
            sys.exit('all uploads failed — aborting before commit')

    # 5. Commit
    print()
    print(f'committing to {BRANCH}: {COMMIT_MSG!r}')
    repo.commit(message=COMMIT_MSG, branch=BRANCH)

    print()
    print('✓ done — bundle pushed to oxen.ai')
    print(f'  https://hub.oxen.ai/{FULL_REPO}')
    print()
    print('next: open that page in your browser and kick off the Qwen Image')
    print('      Edit fine-tune from the oxen.ai UI. Point it at manifest.csv.')


if __name__ == '__main__':
    main()
