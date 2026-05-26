import Link from 'next/link';
import type { ReactNode } from 'react';

export default function ProjectsLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh' }}>
      <header
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid #e5e5e5',
          background: '#fff',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          fontSize: 14,
        }}
      >
        <Link href="/" style={{ fontWeight: 600, textDecoration: 'none', color: '#111' }}>
          map.art
        </Link>
        <span style={{ opacity: 0.3 }}>/</span>
        <Link href="/projects" style={{ textDecoration: 'none', color: '#111' }}>
          projects
        </Link>
        <span style={{ flex: 1 }} />
        <Link href="/admin" style={{ opacity: 0.6, fontSize: 13 }}>
          /admin
        </Link>
      </header>
      <main style={{ padding: 32 }}>{children}</main>
    </div>
  );
}
