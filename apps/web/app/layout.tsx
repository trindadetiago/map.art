import type { ReactNode } from 'react';
import './globals.css';
import { PostHogProvider } from './posthog_provider';

export const metadata = {
  title: 'map.art',
  description: 'Pixel-art map tool',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <PostHogProvider>
        <body>{children}</body>
      </PostHogProvider>
    </html>
  );
}
