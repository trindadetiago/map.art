'use client';

import { PostHogProvider } from '@posthog/react';
import type { PostHogConfig } from 'posthog-js';
import type { ReactNode } from 'react';

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
      {children}
    </PostHogProvider>
  );
}
