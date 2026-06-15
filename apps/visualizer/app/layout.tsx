import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'map.art — visualizer',
  description: 'Deep-zoom viewer for stylized pixel-art maps',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
