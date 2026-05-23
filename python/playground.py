"""map.art — LoRA playground (v01 + v02).

Two modes:

  **Replay trained variant** — pick a kept training pair × mask variant
  (half_L/R/T/B, quad_TL/TR/BL/BR, or full). The hybrid input is already
  on oxen; we just point the inference API at its URL and show input ·
  model output · ground truth side by side.

  **Untrained Full** — pick a render that was NEVER in training, wrap it
  with a 1-px red border on the fly (matches the `full` variant format),
  upload to oxen as a public URL, run inference, show source · output.
  This is the real generalisation test for the v02 LoRA — only v02
  knows the `full` variant; v01 will likely echo the input back.

Set the v02 model id once in the sidebar and the dropdown lets you
flip between v01 and v02 without retyping anything.

Setup:
    .venv/bin/pip install streamlit requests pillow python-dotenv

Usage:
    .venv/bin/streamlit run python/playground.py
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import time
import uuid
from pathlib import Path

import requests
import streamlit as st
from dotenv import load_dotenv
from PIL import Image, ImageDraw

# --- config --------------------------------------------------------------
NAMESPACE = 'trindadetiago'
REPO_NAME = 'mapart-isometric-v01'
HOST = 'hub.oxen.ai'
BRANCH = 'main'
MODELS = {
    'v01': 'trindadetiago-magic-harlequin-hedgehog',
    'v02': 'trindadetiago-linguistic-amaranth-clam',
}
DEFAULT_PROMPT = (
    'Fill in the outlined section with the missing pixels corresponding to the '
    '<mapart isometric pixel art> style, removing the border and exactly '
    'following the shape/style/structure of the surrounding image.'
)
DEFAULT_INFERENCE_STEPS = 28
INFERENCE_URL = f'https://{HOST}/api/images/edit'
VARIANTS = ['half_L', 'half_R', 'half_T', 'half_B', 'quad_TL', 'quad_TR', 'quad_BL', 'quad_BR', 'full']
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
TRAINING_ROOT = REPO_ROOT / 'python' / 'training' / 'v01'
KEEP_FILE = TRAINING_ROOT / '_keep.json'
SAMPLES_ROOT = REPO_ROOT / 'data' / 'renderer' / 'samples'
PLAYGROUND_DIR = TRAINING_ROOT / '_playground'
PLAYGROUND_DIR.mkdir(parents=True, exist_ok=True)


def oxen_image_url(filename: str) -> str:
    return f'https://{HOST}/api/repos/{NAMESPACE}/{REPO_NAME}/file/{BRANCH}/images/{filename}'


def oxen_playground_url(filename: str) -> str:
    return f'https://{HOST}/api/repos/{NAMESPACE}/{REPO_NAME}/file/{BRANCH}/_playground/inputs/{filename}'


def flat_name(pair_id: str, variant: str, *, flip: bool = False) -> str:
    scene, tile = pair_id.split('/', 1)
    return f'{scene}__{tile}__{variant}{"_flip" if flip else ""}.png'


def target_name(pair_id: str, *, flip: bool = False) -> str:
    scene, tile = pair_id.split('/', 1)
    return f'{scene}__{tile}__{"target_flip" if flip else "target"}.png'


def sha8(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:8]


@st.cache_data(show_spinner=False)
def load_kept_pairs() -> list[str]:
    if not KEEP_FILE.exists():
        return []
    keep = json.loads(KEEP_FILE.read_text())
    return sorted(keep.get('kept', []))


@st.cache_data(show_spinner=False)
def discover_untrained_renders() -> list[dict]:
    """Renders that are not in any kept pair — never seen by the model."""
    if not KEEP_FILE.exists():
        return []
    keep = json.loads(KEEP_FILE.read_text())
    kept_set = set(keep.get('kept', []))
    out: list[dict] = []
    for tile in sorted(SAMPLES_ROOT.rglob('c*_r*.png')):
        run, sample = tile.parent.parent.name, tile.parent.name
        pid = f'{run}__{sample}/{tile.stem}'
        if pid in kept_set:
            continue
        out.append({'path': tile, 'pair_id': pid, 'label': f'{sample}/{tile.stem}'})
    return out


def wrap_with_red_border(image_bytes: bytes, *, border_px: int = 1) -> bytes:
    im = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    if im.size != (1024, 1024):
        im = im.resize((1024, 1024), Image.LANCZOS)
    draw = ImageDraw.Draw(im)
    w, h = im.size
    draw.rectangle((0, 0, w - 1, h - 1), outline=(255, 0, 0), width=border_px)
    buf = io.BytesIO()
    im.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


@st.cache_resource(show_spinner=False)
def get_repo():
    from oxen import RemoteRepo
    from oxen.auth import config_auth
    from oxen.user import config_user

    load_dotenv(REPO_ROOT / '.env')
    token = os.environ.get('OXEN_API_KEY')
    if not token:
        st.error('OXEN_API_KEY is not set in `.env`')
        st.stop()
    config_auth(token=token, host=HOST)
    import subprocess

    try:
        name = subprocess.check_output(['git', 'config', 'user.name'], text=True).strip()
        email = subprocess.check_output(['git', 'config', 'user.email'], text=True).strip()
    except Exception:
        name, email = NAMESPACE, f'{NAMESPACE}@users.noreply.oxen.ai'
    config_user(name=name or NAMESPACE, email=email or f'{NAMESPACE}@users.noreply.oxen.ai')
    return RemoteRepo(repo_id=f'{NAMESPACE}/{REPO_NAME}', host=HOST, revision=BRANCH)


def upload_input_to_oxen(image_bytes: bytes, *, dst_name: str) -> str:
    """Stage + commit a one-shot input to `_playground/inputs/<dst_name>`
    and return the URL the oxen inference backend will fetch from. Idempotent.
    """
    repo = get_repo()
    remote_rel = f'_playground/inputs/{dst_name}'
    remote_url = oxen_playground_url(dst_name)
    try:
        if repo.file_exists(remote_rel, revision=BRANCH):
            return remote_url
    except Exception:  # noqa: BLE001
        pass

    if getattr(repo, '_workspace', None) is not None:
        repo._workspace = None

    tmp_path = PLAYGROUND_DIR / dst_name
    tmp_path.write_bytes(image_bytes)
    ws_name = f'playground-{uuid.uuid4().hex[:8]}'
    try:
        repo.add(str(tmp_path), dst='_playground/inputs', branch=BRANCH, workspace_name=ws_name)
        try:
            repo.commit(message=f'playground input: {dst_name}', branch=BRANCH)
        except ValueError as e:
            if 'No changes to commit' in str(e) and repo.file_exists(remote_rel, revision=BRANCH):
                return remote_url
            raise
    finally:
        tmp_path.unlink(missing_ok=True)
    return remote_url


def call_inference(image_url: str, *, model_id: str, prompt: str, steps: int) -> bytes:
    load_dotenv(REPO_ROOT / '.env')
    token = os.environ.get('OXEN_API_KEY', '')
    r = requests.post(
        INFERENCE_URL,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        json={
            'model': model_id,
            'input_image': image_url,
            'prompt': prompt,
            'num_inference_steps': steps,
        },
        timeout=180,
    )
    if r.status_code != 200:
        raise RuntimeError(f'inference HTTP {r.status_code} — {r.text[:500]}')
    if r.headers.get('Content-Type', '').startswith('image/'):
        return r.content
    data = r.json()
    if isinstance(data.get('images'), list) and data['images']:
        first = data['images'][0]
        if isinstance(first, dict) and 'url' in first:
            return requests.get(first['url'], timeout=60).content
        if isinstance(first, str):
            return (
                requests.get(first, timeout=60).content
                if first.startswith('http')
                else base64.b64decode(first)
            )
    for key in ('output_image', 'image', 'image_b64', 'output_url', 'url'):
        if key in data:
            v = data[key]
            if isinstance(v, str) and v.startswith('http'):
                return requests.get(v, timeout=60).content
            if isinstance(v, str):
                return base64.b64decode(v)
    raise RuntimeError(f'unexpected response shape: keys={list(data.keys())[:8]}')


# --- streamlit UI --------------------------------------------------------

st.set_page_config(page_title='map.art playground', layout='wide')
st.title('map.art — LoRA playground')

with st.sidebar:
    st.header('Model')
    model_choice = st.radio(
        'Version',
        ['v02', 'v01', 'custom'],
        format_func=lambda c: {'v01': 'v01 (no full)', 'v02': 'v02 (with full)', 'custom': 'custom'}[c],
        index=0,
    )
    if model_choice == 'custom':
        model_id = st.text_input('Custom model id', value='')
    else:
        model_id = st.text_input(
            f'{model_choice} model id', value=MODELS[model_choice],
            help=f'Edit the {model_choice} id in `python/playground.py` MODELS dict to make it permanent.',
        )
    if 'PASTE' in model_id:
        st.warning('Set the v02 model id (paste from oxen after deploy finishes)')

    st.header('Inference')
    steps = st.slider('Inference steps', 4, 50, DEFAULT_INFERENCE_STEPS)
    prompt = st.text_area('Prompt', value=DEFAULT_PROMPT, height=140)
    use_flip = st.checkbox('Use horizontal-flip variant', value=False)
    border_px = st.slider('Red border width (px) — used in "Untrained Full" mode', 1, 8, 1)
    st.divider()
    st.caption(f'Endpoint: {INFERENCE_URL}')
    st.caption(f'Cache: `{PLAYGROUND_DIR.relative_to(REPO_ROOT)}/`')

mode = st.radio(
    'Mode',
    ['🟢 Replay trained variant', '🔵 Untrained Full (wrap raw render)'],
    horizontal=True,
)


# =========================================================================
# Mode A — Replay trained variant
# =========================================================================
if mode.startswith('🟢'):
    pairs = load_kept_pairs()
    if not pairs:
        st.error('No kept pairs found in _keep.json. Run python/cull.py first.')
        st.stop()

    st.caption(
        f'**{len(pairs)} kept pairs × {len(VARIANTS)} variants = '
        f'{len(pairs) * len(VARIANTS)} test cases**'
    )

    sel_l, sel_r = st.columns([3, 2])
    with sel_l:
        pair_id = st.selectbox(
            'Training pair',
            pairs,
            format_func=lambda p: p.replace('seed42_n50_1779308635275__', ''),
        )
    with sel_r:
        variant = st.selectbox('Mask variant', VARIANTS, index=VARIANTS.index('full'))

    input_url = oxen_image_url(flat_name(pair_id, variant, flip=use_flip))
    target_url = oxen_image_url(target_name(pair_id, flip=use_flip))
    cache_key = (
        f'{pair_id.replace("/", "__")}__{variant}{"_flip" if use_flip else ""}'
        f'__{model_id}__s{steps}.png'
    )
    output_cache = PLAYGROUND_DIR / cache_key

    st.divider()
    cols = st.columns(3)
    with cols[0]:
        st.subheader('input')
        st.caption('hybrid: target context + outlined raw render (sent to model)')
        st.image(input_url, use_container_width=True)
        st.caption(f'`{input_url.rsplit("/", 1)[-1]}`')
    with cols[1]:
        st.subheader('model output')
        if output_cache.exists():
            st.image(output_cache.read_bytes(), use_container_width=True)
            st.caption('cached')
            if st.button('🔄 regenerate'):
                output_cache.unlink()
                st.rerun()
        else:
            if st.button('▶ Generate', type='primary', use_container_width=True):
                status = st.empty()
                try:
                    status.info(f'inferring ({steps} steps)…')
                    t0 = time.time()
                    out_bytes = call_inference(
                        input_url, model_id=model_id, prompt=prompt, steps=steps
                    )
                    output_cache.write_bytes(out_bytes)
                    status.success(f'done in {time.time() - t0:.1f}s')
                    st.image(out_bytes, use_container_width=True)
                except Exception as e:  # noqa: BLE001
                    status.error(f'failed: {type(e).__name__}: {e}')
    with cols[2]:
        st.subheader('ground truth')
        st.caption('gpt-image-2 stylized target')
        st.image(target_url, use_container_width=True)
        st.caption(f'`{target_url.rsplit("/", 1)[-1]}`')

    st.divider()
    with st.expander('🎲 random batch sanity check (5 random variants)'):
        if st.button('Run 5 random'):
            import random

            sample = [(random.choice(pairs), random.choice(VARIANTS)) for _ in range(5)]
            for p, v in sample:
                iu = oxen_image_url(flat_name(p, v, flip=use_flip))
                tu = oxen_image_url(target_name(p, flip=use_flip))
                st.markdown(f'**{p.replace("seed42_n50_1779308635275__", "")} / {v}**')
                row = st.columns(3)
                row[0].image(iu, use_container_width=True)
                with row[1]:
                    ck = (
                        f'{p.replace("/", "__")}__{v}{"_flip" if use_flip else ""}'
                        f'__{model_id}__s{steps}.png'
                    )
                    cp = PLAYGROUND_DIR / ck
                    if cp.exists():
                        st.image(cp.read_bytes(), use_container_width=True)
                    else:
                        try:
                            out = call_inference(iu, model_id=model_id, prompt=prompt, steps=steps)
                            cp.write_bytes(out)
                            st.image(out, use_container_width=True)
                        except Exception as e:  # noqa: BLE001
                            st.error(f'{type(e).__name__}: {e}')
                row[2].image(tu, use_container_width=True)

# =========================================================================
# Mode B — Untrained Full
# =========================================================================
else:
    untrained = discover_untrained_renders()
    if not untrained:
        st.error('No untrained renders found.')
        st.stop()

    st.caption(
        f'**{len(untrained)} renders never in training** — these test whether '
        'the v02 LoRA generalises the `full` variant to new scenes.'
    )

    # Group by sample for friendlier picker
    groups: dict[str, list[dict]] = {}
    for e in untrained:
        s = e['pair_id'].split('/')[0].split('__')[-1]
        groups.setdefault(s, []).append(e)
    g_l, g_r = st.columns([1, 1])
    with g_l:
        sample = st.selectbox('Sample', sorted(groups.keys()))
    with g_r:
        tile = st.selectbox(
            'Tile',
            groups[sample],
            format_func=lambda e: e['pair_id'].split('/')[-1],
        )

    src_path = tile['path']
    src_bytes = src_path.read_bytes()
    wrapped = wrap_with_red_border(src_bytes, border_px=border_px)
    dst_name = f'untrained_{sample}__{src_path.stem}__b{border_px}__{sha8(wrapped)}.png'
    cache_key = f'{dst_name.removesuffix(".png")}__{model_id}__s{steps}.png'
    output_cache = PLAYGROUND_DIR / cache_key

    st.divider()
    cols = st.columns(2)
    with cols[0]:
        st.subheader('source (wrapped, sent to model)')
        st.image(wrapped, use_container_width=True)
        st.caption(f'`{src_path.relative_to(REPO_ROOT)}`')
        st.caption(f'border: {border_px}px · sha {sha8(wrapped)}')
    with cols[1]:
        st.subheader('model output')
        if output_cache.exists():
            st.image(output_cache.read_bytes(), use_container_width=True)
            st.caption('cached')
            if st.button('🔄 regenerate'):
                output_cache.unlink()
                st.rerun()
        else:
            if 'PASTE' in model_id or not model_id.strip():
                st.warning('Set a valid model id in the sidebar first.')
            elif st.button('▶ Generate', type='primary', use_container_width=True):
                status = st.empty()
                try:
                    status.info('uploading wrapped input to oxen…')
                    t0 = time.time()
                    url = upload_input_to_oxen(wrapped, dst_name=dst_name)
                    upload_s = time.time() - t0
                    st.caption(f'oxen URL: `{url}`')
                    status.info(f'inferring ({steps} steps)…')
                    t0 = time.time()
                    out_bytes = call_inference(
                        url, model_id=model_id, prompt=prompt, steps=steps
                    )
                    output_cache.write_bytes(out_bytes)
                    status.success(
                        f'done — upload {upload_s:.1f}s · inference {time.time() - t0:.1f}s'
                    )
                    st.image(out_bytes, use_container_width=True)
                except Exception as e:  # noqa: BLE001
                    status.error(f'failed: {type(e).__name__}: {e}')
