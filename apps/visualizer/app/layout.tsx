import { env } from '@mapart/env';
import { AnalyticsProvider } from '@mapart/ui/analytics';
import { Pixelify_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const pixel = Pixelify_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-pixel',
  display: 'swap',
});

export const metadata = {
  title: 'map.art — visualizer',
  description: 'Deep-zoom viewer for stylized pixel-art maps',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={pixel.variable}>
      <body>
        <AnalyticsProvider projectToken={env.posthogKey}>{children}</AnalyticsProvider>
      </body>
    </html>
  );
}
