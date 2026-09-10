'use client';

import { PostHogProvider, usePostHog } from '@posthog/react';
import type { PostHogConfig, Properties } from 'posthog-js';
import { type ReactNode, createContext, useCallback, useContext, useMemo } from 'react';

const OPTIONS: Partial<PostHogConfig> = {
  // Ingestion goes through the host app's `/ingest` rewrite instead of straight to
  // PostHog — content blockers drop requests by hostname, and a same-origin path
  // isn't one they match on. `ui_host` keeps the toolbar links pointing at the app.
  api_host: '/ingest',
  ui_host: 'https://us.posthog.com',
  // posthog-js hooks the History API itself, so App Router client navigations emit
  // a $pageview without a route-watching effect on our side.
  capture_pageview: 'history_change',
  capture_exceptions: true,
  debug: process.env.NODE_ENV === 'development',
};

export interface Analytics {
  /** Records a named product event. A no-op while analytics is off. */
  capture: (event: string, properties?: Properties) => void;
}

const NOOP: Analytics = { capture: () => {} };

// Components call `useAnalytics()` whether or not a token is configured, so the
// off state has to be a real value rather than a missing provider: PostHog's own
// hook falls back to the uninitialised global client, which logs an error on
// every capture.
const AnalyticsContext = createContext<Analytics>(NOOP);

export interface AnalyticsProviderProps {
  /** PostHog project token. Analytics stays off entirely while this is empty. */
  projectToken: string | undefined;
  children: ReactNode;
}

/**
 * Wraps an app in PostHog. The token is a prop rather than an env read so the host
 * app's server layout can source it from `@mapart/env`, which also means it resolves
 * at runtime instead of being baked into the client bundle.
 */
export function AnalyticsProvider({ projectToken, children }: AnalyticsProviderProps) {
  if (!projectToken) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider apiKey={projectToken} options={OPTIONS}>
      <CaptureBridge>{children}</CaptureBridge>
    </PostHogProvider>
  );
}

/** Binds the context to the PostHog client that `PostHogProvider` just created. */
function CaptureBridge({ children }: { children: ReactNode }) {
  const posthog = usePostHog();
  const capture = useCallback<Analytics['capture']>(
    (event, properties) => {
      posthog.capture(event, properties);
    },
    [posthog],
  );
  const value = useMemo<Analytics>(() => ({ capture }), [capture]);
  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

/** Product-event capture for client components. Safe to call with analytics off. */
export function useAnalytics(): Analytics {
  return useContext(AnalyticsContext);
}
