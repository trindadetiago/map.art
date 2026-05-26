import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'map.art',
  description: 'Pixel-art map tool',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
