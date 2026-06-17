'use client';

import type { VizMetadata, VizPin } from '@mapart/export/types';
import { useState } from 'react';
import { Viewer } from './viewer';

/**
 * Museum/gallery chrome around the deep-zoom map: the pixel-art sits matted in a
 * gilded frame on a dark wall, with a brass placard (name · year) and a control
 * cluster — home (back to the globe), a pins toggle, and a "more information"
 * drawer carrying the full description + export stats.
 */
export function Frame({
  projectId,
  meta,
  pins,
  name,
  year,
  description,
}: {
  projectId: string;
  meta: VizMetadata;
  pins: VizPin[];
  name: string;
  year: number | null;
  description: string | null;
}) {
  const [showPins, setShowPins] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className="stage">
      <div className="frame">
        <div className="matte">
          <Viewer projectId={projectId} meta={meta} pins={pins} showPins={showPins} />
        </div>

        <div className="placard">
          <span className="placard-name">{name}</span>
          {year !== null && <span className="placard-year">{year}</span>}
        </div>
      </div>

      <div className="toolbar toolbar-left">
        <a href="/" className="frame-btn" title="Back to globe" aria-label="Back to globe">
          ⌂
        </a>
      </div>

      <div className="toolbar toolbar-right">
        {pins.length > 0 && (
          <button
            type="button"
            className={`frame-btn${showPins ? ' is-active' : ''}`}
            onClick={() => setShowPins((v) => !v)}
            title={showPins ? 'Hide pins' : 'Show pins'}
          >
            ◉
          </button>
        )}
        <button
          type="button"
          className={`frame-btn${infoOpen ? ' is-active' : ''}`}
          onClick={() => setInfoOpen((v) => !v)}
          title="More information"
        >
          ℹ
        </button>
      </div>

      {infoOpen && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-away backdrop */}
          <div className="drawer-scrim" onClick={() => setInfoOpen(false)} />
          <aside className="drawer">
            <div className="drawer-head">
              <h2>{name}</h2>
              <button
                type="button"
                className="drawer-close"
                onClick={() => setInfoOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {year !== null && <div className="drawer-year">{year}</div>}
            {description ? (
              <p className="drawer-desc">{description}</p>
            ) : (
              <p className="drawer-desc muted">No description yet.</p>
            )}
            <dl className="drawer-meta">
              <div>
                <dt>Grid</dt>
                <dd>
                  {meta.gridWidth}×{meta.gridHeight} tiles
                </dd>
              </div>
              <div>
                <dt>Resolution</dt>
                <dd>
                  {meta.width.toLocaleString()}×{meta.height.toLocaleString()} px
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{meta.source}</dd>
              </div>
            </dl>
          </aside>
        </>
      )}
    </div>
  );
}
