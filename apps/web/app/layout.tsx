import type { ReactNode } from 'react';

export const metadata = {
  title: 'map.art',
  description: 'Pixel-art map tool',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#111',
          background: '#fafafa',
        }}
      >
        {children}
      </body>
    </html>
  );
}
