import { env } from '@mapart/env';
import { AnalyticsProvider } from '@mapart/ui/analytics';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'earthToPixels',
  description: 'Pixel-art map tool',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AnalyticsProvider projectToken={env.posthogKey}>{children}</AnalyticsProvider>
      </body>
    </html>
  );
}
