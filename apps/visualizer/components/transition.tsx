'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useState } from 'react';

/** Each page's own background, so a curtain in that colour hides the swap. */
export const HOME_BG = '#ffffff';
export const MAP_BG = '#0c0b0a';

/** Roughly the curtain-in animation, so the push lands under a solid wash. */
const COVER_MS = 240;

/**
 * Fades the incoming page in from a flat wash of its own background colour.
 * Render it once at the root of a page.
 */
export function PageFade({ color }: { color: string }) {
  return <div className="page-curtain page-curtain-out" style={{ background: color }} />;
}

/**
 * Client navigation that washes the screen in the destination's background
 * colour before pushing, so it meets that page's own `<PageFade>` mid-fade and
 * the two read as one cross-dissolve.
 */
export function useCurtainNav(): { go: (href: string, color: string) => void; curtain: ReactNode } {
  const router = useRouter();
  const [color, setColor] = useState<string | null>(null);

  const go = useCallback(
    (href: string, curtainColor: string): void => {
      setColor(curtainColor);
      window.setTimeout(() => router.push(href), COVER_MS);
    },
    [router],
  );

  return {
    go,
    curtain: color ? (
      <div className="page-curtain page-curtain-in" style={{ background: color }} />
    ) : null,
  };
}
