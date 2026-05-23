"""map.art — Algorithm A playground.

Walks a 3×3 grid of raw renders through the v02 LoRA in expanding-radius
order, building each step's input by combining the tile's raw render
with thin strips from already-stylized neighbours (so the model has
something to extend the style from).

Order: (0,0) → (0,1)(1,0) → (0,2)(1,1)(2,0) → (1,2)(2,1) → (2,2)
       seed     radius 1      radius 2          radius 3   radius 4

Composite recipe (per non-seed tile):
  - Image is always 1024×1024.
  - Center 80% (820×820) = the raw render to be stylized.
  - Each side with a stylized N/S/E/W neighbour: 10% strip (102px)
    from the neighbour's adjacent edge.
  - Missing neighbour (grid edge) → use the OPPOSITE side at 20%
    instead, to keep the composite square without padding.
  - 1-px red rectangle around the central rendered region — same
    convention the LoRA was trained on.

Diagonals (NE/NW/SE/SW) are intentionally skipped: including them would
make the red-outlined region non-rectangular, which is out of training
distribution.

Setup:
    .venv/bin/pip install streamlit requests pillow python-dotenv

Usage:
    .venv/bin/streamlit run python/algorithm_playground.py
"""

from __future__ import annotations

import base64
import hashlib
import io
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
    'v02': 'trindadetiago-linguistic-amaranth-clam',
    'v01': 'trindadetiago-magic-harlequin-hedgehog',
}
DEFAULT_PROMPT = (
    'Fill in the outlined section with the missing pixels corresponding to the '
    '<mapart isometric pixel art> style, removing the border and exactly '
    'following the shape/style/structure of the surrounding image.'
)
DEFAULT_INFERENCE_STEPS = 28
DEFAULT_CONTEXT_PCT = 10  # % of the composite width given to each neighbour strip
TILE_SIZE = 1024
INFERENCE_URL = f'https://{HOST}/api/images/edit'

# Anti-diagonal expansion: index = step #, value = (row, col).
ORDER = [
    (0, 0),
    (0, 1), (1, 0),
    (0, 2), (1, 1), (2, 0),
    (1, 2), (2, 1),
    (2, 2),
]
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
TEST_GRIDS = REPO_ROOT / 'python' / 'test_grids'
CACHE_DIR = REPO_ROOT / 'python' / 'training' / 'v01' / '_algorithm_playground'
CACHE_DIR.mkdir(parents=True, exist_ok=True)


# --- grid discovery ------------------------------------------------------

def user_to_filename(row: int, col: int) -> str:
    """User (row 0=top, col 0=left) → renderer filename c{col}_r{row}.

    Renderer convention: c ∈ {-1, 0, 1}, r ∈ {-1, 0, 1}, r=+1 is top.
    """
    return f'c{col - 1}_r{1 - row}.png'


@st.cache_data(show_spinner=False)
def discover_grids() -> list[str]:
    if not TEST_GRIDS.is_dir():
        return []
    out = []
    for d in sorted(TEST_GRIDS.iterdir()):
        if not d.is_dir() or d.name.startswith('_'):
            continue
        # Need all 9 tiles to be a valid 3×3 grid
        ok = all((d / user_to_filename(r, c)).exists() for r in range(3) for c in range(3))
        if ok:
            out.append(d.name)
    return out


def load_grid_tiles(grid_name: str) -> dict[tuple[int, int], Image.Image]:
    base = TEST_GRIDS / grid_name
    tiles: dict[tuple[int, int], Image.Image] = {}
    for r in range(3):
        for c in range(3):
            p = base / user_to_filename(r, c)
            im = Image.open(p).convert('RGB')
            if im.size != (TILE_SIZE, TILE_SIZE):
                im = im.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
            tiles[(r, c)] = im
    return tiles


# --- composite ----------------------------------------------------------

def context_widths(
    has_N: bool, has_S: bool, has_W: bool, has_E: bool, *, base: int
) -> tuple[int, int, int, int]:
    """Return (top_h, bot_h, left_w, right_w) in pixels.
    Missing neighbour → 0 on that side, but add `base` to the opposite
    side IF the opposite is present, keeping the composite square.
    """
    top_h = base if has_N else 0
    bot_h = base if has_S else 0
    left_w = base if has_W else 0
    right_w = base if has_E else 0
    if not has_N and has_S:
        bot_h = 2 * base
    if not has_S and has_N:
        top_h = 2 * base
    if not has_W and has_E:
        right_w = 2 * base
    if not has_E and has_W:
        left_w = 2 * base
    return top_h, bot_h, left_w, right_w


def build_composite(
    raw_tiles: dict[tuple[int, int], Image.Image],
    stylized: dict[tuple[int, int], Image.Image],
    row: int,
    col: int,
    *,
    context_pct: float,
) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Return (composite_PIL, bbox_of_red_outlined_region)."""
    base = int(round(TILE_SIZE * context_pct / 100))  # px per 10%

    def has(nr: int, nc: int) -> bool:
        return 0 <= nr < 3 and 0 <= nc < 3 and (nr, nc) in stylized

    has_N = has(row - 1, col)
    has_S = has(row + 1, col)
    has_W = has(row, col - 1)
    has_E = has(row, col + 1)

    top_h, bot_h, left_w, right_w = context_widths(
        has_N, has_S, has_W, has_E, base=base
    )
    center_w = TILE_SIZE - left_w - right_w
    center_h = TILE_SIZE - top_h - bot_h

    composite = Image.new('RGB', (TILE_SIZE, TILE_SIZE), (0, 0, 0))

    # Center = raw render of the tile we're stylizing, resized to (center_w, center_h)
    raw = raw_tiles[(row, col)].resize((center_w, center_h), Image.LANCZOS)
    composite.paste(raw, (left_w, top_h))

    # Neighbour strips — take the edge of the neighbour adjacent to this tile.
    if has_N:
        n = stylized[(row - 1, col)]
        strip = n.crop((0, TILE_SIZE - top_h, TILE_SIZE, TILE_SIZE)).resize(
            (center_w, top_h), Image.LANCZOS
        )
        composite.paste(strip, (left_w, 0))
    if has_S:
        s = stylized[(row + 1, col)]
        strip = s.crop((0, 0, TILE_SIZE, bot_h)).resize(
            (center_w, bot_h), Image.LANCZOS
        )
        composite.paste(strip, (left_w, top_h + center_h))
    if has_W:
        w = stylized[(row, col - 1)]
        strip = w.crop((TILE_SIZE - left_w, 0, TILE_SIZE, TILE_SIZE)).resize(
            (left_w, center_h), Image.LANCZOS
        )
        composite.paste(strip, (0, top_h))
    if has_E:
        e = stylized[(row, col + 1)]
        strip = e.crop((0, 0, right_w, TILE_SIZE)).resize(
            (right_w, center_h), Image.LANCZOS
        )
        composite.paste(strip, (left_w + center_w, top_h))

    # Fill the 4 diagonal corner areas. When BOTH adjacent edge strips
    # exist, there's a corner of size (corner_w × corner_h) that the
    # edge strips don't cover — it would be black without this. Use the
    # diagonal neighbour's matching corner if it's already stylized;
    # otherwise extend whichever adjacent edge strip is available.
    def _corner_fill(
        dst_xy: tuple[int, int],
        corner_size: tuple[int, int],
        diag_pos: tuple[int, int],
        diag_crop_box: tuple[int, int, int, int] | None,
        fallback_strip_box: tuple[int, int, int, int] | None,
        fallback_strip_pos: tuple[int, int] | None,
    ) -> None:
        cw, ch = corner_size
        if cw <= 0 or ch <= 0:
            return
        dr, dc = diag_pos
        src = None
        if 0 <= dr < 3 and 0 <= dc < 3 and (dr, dc) in stylized and diag_crop_box is not None:
            src = stylized[(dr, dc)].crop(diag_crop_box)
        elif fallback_strip_pos is not None and fallback_strip_box is not None:
            # No diagonal — pull the corner from an adjacent neighbour
            # we already have (extends N's bottom-left for an NW corner, etc.)
            fr, fc = fallback_strip_pos
            if 0 <= fr < 3 and 0 <= fc < 3 and (fr, fc) in stylized:
                src = stylized[(fr, fc)].crop(fallback_strip_box)
        if src is not None:
            composite.paste(src.resize((cw, ch), Image.LANCZOS), dst_xy)

    # NW corner: composite (0,0)..(left_w, top_h)
    _corner_fill(
        dst_xy=(0, 0),
        corner_size=(left_w, top_h),
        diag_pos=(row - 1, col - 1),
        diag_crop_box=(TILE_SIZE - left_w, TILE_SIZE - top_h, TILE_SIZE, TILE_SIZE),
        # Fallback: N tile's bottom-left
        fallback_strip_box=(0, TILE_SIZE - top_h, left_w, TILE_SIZE),
        fallback_strip_pos=(row - 1, col),
    )
    # NE corner: composite (left_w+center_w, 0)..(TILE_SIZE, top_h)
    _corner_fill(
        dst_xy=(left_w + center_w, 0),
        corner_size=(right_w, top_h),
        diag_pos=(row - 1, col + 1),
        diag_crop_box=(0, TILE_SIZE - top_h, right_w, TILE_SIZE),
        fallback_strip_box=(TILE_SIZE - right_w, TILE_SIZE - top_h, TILE_SIZE, TILE_SIZE),
        fallback_strip_pos=(row - 1, col),
    )
    # SW corner: composite (0, top_h+center_h)..(left_w, TILE_SIZE)
    _corner_fill(
        dst_xy=(0, top_h + center_h),
        corner_size=(left_w, bot_h),
        diag_pos=(row + 1, col - 1),
        diag_crop_box=(TILE_SIZE - left_w, 0, TILE_SIZE, bot_h),
        fallback_strip_box=(0, 0, left_w, bot_h),
        fallback_strip_pos=(row + 1, col),
    )
    # SE corner: composite (left_w+center_w, top_h+center_h)..(TILE_SIZE, TILE_SIZE)
    _corner_fill(
        dst_xy=(left_w + center_w, top_h + center_h),
        corner_size=(right_w, bot_h),
        diag_pos=(row + 1, col + 1),
        diag_crop_box=(0, 0, right_w, bot_h),
        fallback_strip_box=(TILE_SIZE - right_w, 0, TILE_SIZE, bot_h),
        fallback_strip_pos=(row + 1, col),
    )

    # Red outline around the rendered region (always rectangular).
    draw = ImageDraw.Draw(composite)
    bbox = (left_w, top_h, left_w + center_w, top_h + center_h)
    draw.rectangle(
        (bbox[0], bbox[1], bbox[2] - 1, bbox[3] - 1),
        outline=(255, 0, 0),
        width=1,
    )
    return composite, bbox


def extract_stylized(output_img: Image.Image, bbox: tuple[int, int, int, int]) -> Image.Image:
    """Crop the outlined region and resize back to 1024×1024."""
    cropped = output_img.crop(bbox)
    if cropped.size != (TILE_SIZE, TILE_SIZE):
        cropped = cropped.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
    return cropped


def stitch_grid(
    raw_tiles: dict[tuple[int, int], Image.Image],
    stylized: dict[tuple[int, int], Image.Image],
) -> Image.Image:
    """Compose all 9 tiles into a single 3072×3072 PNG. Stylized tiles
    where available, raw renders for the rest — so progress is visible."""
    out = Image.new('RGB', (TILE_SIZE * 3, TILE_SIZE * 3), (0, 0, 0))
    for r in range(3):
        for c in range(3):
            tile = stylized.get((r, c)) or raw_tiles[(r, c)]
            if tile.size != (TILE_SIZE, TILE_SIZE):
                tile = tile.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
            out.paste(tile, (c * TILE_SIZE, r * TILE_SIZE))
    return out


# --- oxen + inference (duplicated from playground.py to avoid import) ----

def sha8(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:8]


def pil_to_png_bytes(im: Image.Image) -> bytes:
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
    repo = get_repo()
    remote_rel = f'_playground/inputs/{dst_name}'
    remote_url = f'https://{HOST}/api/repos/{NAMESPACE}/{REPO_NAME}/file/{BRANCH}/{remote_rel}'
    try:
        if repo.file_exists(remote_rel, revision=BRANCH):
            return remote_url
    except Exception:  # noqa: BLE001
        pass
    if getattr(repo, '_workspace', None) is not None:
        repo._workspace = None
    tmp = CACHE_DIR / dst_name
    tmp.write_bytes(image_bytes)
    ws_name = f'algoa-{uuid.uuid4().hex[:8]}'
    try:
        repo.add(str(tmp), dst='_playground/inputs', branch=BRANCH, workspace_name=ws_name)
        try:
            repo.commit(message=f'algorithm playground: {dst_name}', branch=BRANCH)
        except ValueError as e:
            if 'No changes to commit' in str(e) and repo.file_exists(remote_rel, revision=BRANCH):
                return remote_url
            raise
    finally:
        tmp.unlink(missing_ok=True)
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

st.set_page_config(page_title='map.art — Algorithm A', layout='wide')
st.title('map.art — Algorithm A (expanding-radius infill)')
st.markdown(
    'Pick a 3×3 grid of **never-trained** renders. Algorithm A walks them in '
    'expanding-radius order from `(0,0)`, building each step\'s input from the '
    'raw tile + thin strips of already-stylized N/S/E/W neighbours.'
)

with st.sidebar:
    st.header('Model')
    model_choice = st.radio(
        'Version', ['v02', 'v01', 'custom'],
        format_func=lambda c: {'v01': 'v01 (no full)', 'v02': 'v02 (with full)', 'custom': 'custom'}[c],
        index=0,
    )
    if model_choice == 'custom':
        model_id = st.text_input('Custom model id', value='')
    else:
        model_id = st.text_input(f'{model_choice} model id', value=MODELS[model_choice])

    st.header('Inference')
    steps = st.slider('Inference steps', 4, 50, DEFAULT_INFERENCE_STEPS)
    prompt = st.text_area('Prompt', value=DEFAULT_PROMPT, height=140)

    st.header('Algorithm A')
    context_pct = st.slider(
        'Neighbour strip width (% of 1024 per side)',
        4, 25, DEFAULT_CONTEXT_PCT,
        help='10% = ~102px. Higher gives the model more anchor but shrinks '
             'the renderable centre.',
    )
    st.divider()
    st.caption(f'Test grids: `{TEST_GRIDS.relative_to(REPO_ROOT)}/`')
    st.caption(f'Cache: `{CACHE_DIR.relative_to(REPO_ROOT)}/`')

grids = discover_grids()
if not grids:
    st.error(
        f'No grids under `{TEST_GRIDS}`. Drop a folder of 9 PNGs named '
        '`c-1_r-1.png` … `c1_r1.png` into that directory.'
    )
    st.stop()

g_col, btn_col = st.columns([3, 1])
with g_col:
    grid_name = st.selectbox(f'Grid ({len(grids)} untrained available)', grids)
with btn_col:
    st.write('')
    st.write('')
    run = st.button('▶ Run Algorithm A', type='primary', use_container_width=True)
    if st.button('🗑 clear cache for this grid', use_container_width=True):
        for f in CACHE_DIR.glob(f'algA__{grid_name}__*.png'):
            f.unlink()
        st.rerun()

raw_tiles = load_grid_tiles(grid_name)

st.divider()
st.markdown('### raw input grid')
grid_rows = st.columns(3)
for r in range(3):
    cols = grid_rows[r].columns(3) if False else None  # placeholder, fix below
preview = st.columns(3)
# Render 3x3 in row-major using nested columns properly
for r in range(3):
    row_cols = st.columns(3)
    for c in range(3):
        with row_cols[c]:
            st.image(raw_tiles[(r, c)], use_container_width=True)
            st.caption(f'`({r},{c})` — {user_to_filename(r, c)}')

# Cache helpers
def cache_path(row: int, col: int) -> Path:
    return CACHE_DIR / f'algA__{grid_name}__{model_id}__s{steps}__c{context_pct}__r{row}c{col}.png'


def load_cached_stylized() -> dict[tuple[int, int], Image.Image]:
    out: dict[tuple[int, int], Image.Image] = {}
    for r in range(3):
        for c in range(3):
            p = cache_path(r, c)
            if p.exists():
                out[(r, c)] = Image.open(p).convert('RGB')
    return out




initial_stylized = load_cached_stylized()
done_count = len(initial_stylized)

# Progress section — populated only during a run
st.divider()
if done_count:
    st.caption(f'{done_count}/9 tiles already cached for this config (model/steps/context%).')
progress_holder = st.container()

# Stitched grids — ALWAYS at the bottom, side-by-side comparison.
# Left = original raw grid (static, never changes for a given grid).
# Right = generated grid (placeholder that updates after each step).
st.divider()
st.markdown('### stitched 3×3 — original vs generated')
cmp_l, cmp_r = st.columns(2)
with cmp_l:
    st.caption('🟫 original — raw renders, stitched')
    st.image(stitch_grid(raw_tiles, {}), use_container_width=True)
with cmp_r:
    st.caption('🎨 generated — current progress')
    stitched_placeholder = st.empty()
    stitched_caption = st.empty()


def render_stitched(stylized_state: dict[tuple[int, int], Image.Image], note: str) -> None:
    img = stitch_grid(raw_tiles, stylized_state)
    stitched_placeholder.image(img, use_container_width=True)
    stitched_caption.caption(
        f'{len(stylized_state)}/9 stylized · {note}  ·  '
        'raw renders shown for tiles not yet stylized'
    )


render_stitched(
    initial_stylized,
    note='loaded from cache' if done_count else 'no tiles stylized yet — press ▶ to start',
)

# --- per-tile regenerate -----------------------------------------------
# Available once ALL 9 tiles are cached. Regenerating one tile uses ALL its
# current neighbours as context (4 sides + 4 diagonals where in-bounds) —
# the regenerated tile actually gets BETTER context than it had originally,
# since at original-ORDER time it may have only had 0-2 neighbours stylized.
# We do NOT cascade invalidate downstream tiles: the small boundary drift
# between the regenerated tile's new edge and its neighbours' cached edges
# is acceptable, and lets you iterate one tile at a time cheaply.
if not run and len(initial_stylized) == 9:
    st.divider()
    st.markdown('### regenerate individual tiles')
    st.caption(
        'Click a tile to regenerate it. The new version uses ALL 8 '
        'currently-stylized neighbours as context (often better than the '
        'original run, which only had whatever was done by that ORDER step). '
        'Downstream tiles stay cached — boundary mismatches are tolerated.'
    )
    for r_ in range(3):
        rs = st.columns(3)
        for c_ in range(3):
            with rs[c_]:
                st.image(initial_stylized[(r_, c_)], use_container_width=True)
                if st.button(
                    f'🔄 regen ({r_},{c_})',
                    key=f'regen_{r_}_{c_}',
                    use_container_width=True,
                ):
                    cache_path(r_, c_).unlink(missing_ok=True)
                    st.session_state['pending_regen'] = True
                    st.rerun()

# Promote a pending-regen flag (set by the buttons above on the prior render)
# into an actual run so the missing tiles are re-stylized immediately.
if st.session_state.get('pending_regen'):
    run = True
    st.session_state['pending_regen'] = False

if run:
    stylized = dict(initial_stylized)
    overall = st.progress(0.0, text='Starting…')
    for step, (row, col) in enumerate(ORDER, start=1):
        with progress_holder:
            st.markdown(f'#### Step {step}/9 — tile `({row},{col})`')
        if (row, col) in stylized:
            with progress_holder:
                st.info(f'using cached result for ({row},{col})')
            overall.progress(step / 9, text=f'{step}/9 cached')
            render_stitched(stylized, note=f'after step {step}/9 (cached)')
            continue

        try:
            composite, bbox = build_composite(
                raw_tiles, stylized, row, col, context_pct=context_pct
            )
            composite_bytes = pil_to_png_bytes(composite)
            dst_name = f'algA__{grid_name}__r{row}c{col}__{sha8(composite_bytes)}.png'

            t0 = time.time()
            with progress_holder:
                status = st.empty()
                status.info(f'uploading composite ({len(composite_bytes) // 1024} KB)…')
            url = upload_input_to_oxen(composite_bytes, dst_name=dst_name)
            up_s = time.time() - t0

            t0 = time.time()
            with progress_holder:
                status.info(f'inferring ({steps} steps)…')
            out_bytes = call_inference(url, model_id=model_id, prompt=prompt, steps=steps)
            inf_s = time.time() - t0

            output_img = Image.open(io.BytesIO(out_bytes)).convert('RGB')
            stylized_tile = extract_stylized(output_img, bbox)
            cache_path(row, col).write_bytes(pil_to_png_bytes(stylized_tile))
            stylized[(row, col)] = stylized_tile

            with progress_holder:
                status.success(f'done — upload {up_s:.1f}s · infer {inf_s:.1f}s')
                three = st.columns(3)
                three[0].image(composite, caption=f'composite input (bbox {bbox})', use_container_width=True)
                three[1].image(output_img, caption='full model output', use_container_width=True)
                three[2].image(stylized_tile, caption=f'cropped → stylized ({row},{col})', use_container_width=True)

            render_stitched(stylized, note=f'after step {step}/9')
        except Exception as e:  # noqa: BLE001
            with progress_holder:
                st.error(f'tile ({row},{col}) failed: {type(e).__name__}: {e}')
            render_stitched(stylized, note=f'halted at step {step}/9 — error')
            st.stop()

        overall.progress(step / 9, text=f'{step}/9 tiles done')

    overall.progress(1.0, text='all 9 tiles stylized')
    render_stitched(stylized, note='✅ complete')
    # Re-run so the regen UI block (gated on all-9-cached) becomes visible.
    # The per-step progress that was just rendered remains accessible via
    # cache — and the stitched view shows the final result immediately.
    time.sleep(0.6)
    st.rerun()
