"""map.art — v01 training pair cull tool.

Side-by-side reviewer for every complete (source, target) pair under
python/training/v01/. Click Keep / Drop / Skip to tag and auto-advance.
Decisions persist to python/training/v01/_keep.json after every click,
so closing and reopening the app resumes where you left off.

Usage:
    pip install streamlit
    streamlit run python/cull.py

Keyboard (best-effort via injected JS — buttons always work):
    k = keep, d = drop, s = skip,  ← = back, → = skip (forward)
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import streamlit as st


def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(10):
        if (cur / 'pnpm-workspace.yaml').exists():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    raise RuntimeError('repo root not found (no pnpm-workspace.yaml walking up)')


REPO_ROOT = find_repo_root(Path(__file__).parent)
TRAINING_ROOT = REPO_ROOT / 'python' / 'training' / 'v01'
KEEP_FILE = TRAINING_ROOT / '_keep.json'


def discover_complete_pairs() -> list[dict]:
    pairs: list[dict] = []
    if not TRAINING_ROOT.is_dir():
        return pairs
    for scene_dir in sorted(TRAINING_ROOT.iterdir()):
        if not scene_dir.is_dir() or scene_dir.name.startswith('_'):
            continue
        for tile_dir in sorted(scene_dir.iterdir()):
            if not tile_dir.is_dir():
                continue
            src = tile_dir / 'source.png'
            tgt = tile_dir / 'target.png'
            if src.exists() and tgt.exists():
                pairs.append(
                    {
                        'pair_id': f'{scene_dir.name}/{tile_dir.name}',
                        'scene_id': scene_dir.name,
                        'tile_id': tile_dir.name,
                        'source_path': src,
                        'target_path': tgt,
                    }
                )
    return pairs


def load_state() -> dict:
    if KEEP_FILE.exists():
        data = json.loads(KEEP_FILE.read_text())
        data.setdefault('kept', [])
        data.setdefault('dropped', [])
        return data
    return {'version': 1, 'kept': [], 'dropped': [], 'updated_at': None}


def save_state(state: dict) -> None:
    state['updated_at'] = datetime.utcnow().isoformat() + 'Z'
    tmp = KEEP_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(KEEP_FILE)


# --- session bootstrap ---------------------------------------------------

st.set_page_config(page_title='map.art cull v01', layout='wide')

if 'pairs' not in st.session_state:
    st.session_state.pairs = discover_complete_pairs()
    st.session_state.state = load_state()
    reviewed = set(st.session_state.state['kept']) | set(st.session_state.state['dropped'])
    st.session_state.idx = 0
    for i, p in enumerate(st.session_state.pairs):
        if p['pair_id'] not in reviewed:
            st.session_state.idx = i
            break
    # Keep the jump-to-input widget in sync with idx so it doesn't fight
    # callbacks during rerun.
    st.session_state['_jump_input'] = st.session_state.idx + 1

pairs: list[dict] = st.session_state.pairs
state: dict = st.session_state.state
n = len(pairs)

if n == 0:
    st.error(f'No complete pairs found under {TRAINING_ROOT.relative_to(REPO_ROOT)}/')
    st.stop()

# --- progress header -----------------------------------------------------

n_kept = len(state['kept'])
n_dropped = len(state['dropped'])
n_reviewed = n_kept + n_dropped

st.progress(n_reviewed / n)
st.markdown(
    f'**{n_reviewed}/{n} reviewed**  ·  '
    f'kept **{n_kept}**  ·  dropped **{n_dropped}**  ·  '
    f'remaining **{n - n_reviewed}**  ·  '
    f'state: `{KEEP_FILE.relative_to(REPO_ROOT)}`'
)

# --- pair display --------------------------------------------------------

st.session_state.idx = max(0, min(st.session_state.idx, n - 1))
idx = st.session_state.idx
pair = pairs[idx]

current_status = 'unset'
if pair['pair_id'] in state['kept']:
    current_status = '✅ kept'
elif pair['pair_id'] in state['dropped']:
    current_status = '❌ dropped'

st.markdown(f'### Pair {idx + 1}/{n} — `{pair["pair_id"]}`  ({current_status})')

col_src, col_tgt = st.columns(2)
with col_src:
    st.caption('source (3D render)')
    st.image(str(pair['source_path']), use_container_width=True)
with col_tgt:
    st.caption('target (gpt-image-2)')
    st.image(str(pair['target_path']), use_container_width=True)

# --- actions -------------------------------------------------------------


def _set_status(pid: str, *, keep: bool) -> None:
    if keep:
        if pid in state['dropped']:
            state['dropped'].remove(pid)
        if pid not in state['kept']:
            state['kept'].append(pid)
    else:
        if pid in state['kept']:
            state['kept'].remove(pid)
        if pid not in state['dropped']:
            state['dropped'].append(pid)
    save_state(state)


def _advance(delta: int) -> None:
    st.session_state.idx = max(0, min(st.session_state.idx + delta, n - 1))
    st.session_state['_jump_input'] = st.session_state.idx + 1


def on_keep():
    _set_status(pairs[st.session_state.idx]['pair_id'], keep=True)
    _advance(+1)


def on_drop():
    _set_status(pairs[st.session_state.idx]['pair_id'], keep=False)
    _advance(+1)


def on_skip():
    _advance(+1)


def on_back():
    _advance(-1)


def on_jump():
    st.session_state.idx = int(st.session_state['_jump_input']) - 1


b1, b2, b3, b4 = st.columns(4)
with b1:
    st.button('✅ Keep (k)', on_click=on_keep, type='primary', use_container_width=True)
with b2:
    st.button('❌ Drop (d)', on_click=on_drop, use_container_width=True)
with b3:
    st.button('⏭ Skip (s)', on_click=on_skip, use_container_width=True)
with b4:
    st.button('← Back', on_click=on_back, use_container_width=True)

# Jump-to-pair input — `on_change` keeps idx in sync without fighting reruns.
st.number_input(
    'Jump to pair #',
    min_value=1,
    max_value=n,
    step=1,
    key='_jump_input',
    on_change=on_jump,
)

# --- keyboard shortcuts (best-effort) ------------------------------------
# Streamlit doesn't expose keyboard bindings natively; this is a thin JS
# bridge that clicks the visible buttons. Works in most browsers/themes
# but may break across Streamlit versions — the buttons are the source of
# truth.

st.markdown(
    """
<script>
document.addEventListener('keydown', function(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const docs = [document];
    if (window.parent && window.parent.document !== document) docs.push(window.parent.document);
    const findBtn = (needle) => {
        for (const d of docs) {
            const btns = d.querySelectorAll('button');
            for (const b of btns) if ((b.innerText || '').includes(needle)) return b;
        }
        return null;
    };
    let b = null;
    if (e.key === 'k') b = findBtn('Keep');
    else if (e.key === 'd') b = findBtn('Drop');
    else if (e.key === 's') b = findBtn('Skip');
    else if (e.key === 'ArrowLeft') b = findBtn('Back');
    else if (e.key === 'ArrowRight') b = findBtn('Skip');
    if (b) { e.preventDefault(); b.click(); }
});
</script>
    """,
    unsafe_allow_html=True,
)
