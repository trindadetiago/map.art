'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useEffect } from 'react';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const posthogKey = process.env.VITE_POSTHOG_PROJECT_TOKEN;

    // Debug logging
    console.log('🔍 PostHog Debug:', {
      key: posthogKey ? '✅ Present' : '❌ Missing',
      nodeEnv: process.env.NODE_ENV,
      isClient: typeof window !== 'undefined',
    });

    if (!posthogKey) {
      console.error('❌ PostHog key is missing! Check your environment variables.');
      return;
    }

    posthog.init(posthogKey, {
      api_host: 'https://us.posthog.com',
      ui_host: 'https://us.posthog.com',
      capture_exceptions: true, // This enables capturing exceptions using Error Tracking, set to false if you don't want this
      debug: process.env.NODE_ENV === 'development',
    });
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
