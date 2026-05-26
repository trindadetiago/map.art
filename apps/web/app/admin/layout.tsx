import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
      <aside
        style={{
          padding: 24,
          borderRight: '1px solid #e5e5e5',
          background: '#fff',
          fontSize: 14,
        }}
      >
        <Link href="/" style={{ opacity: 0.6, textDecoration: 'none' }}>
          ← home
        </Link>
        <h2
          style={{
            fontSize: 14,
            marginTop: 24,
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: 1,
            opacity: 0.5,
          }}
        >
          admin
        </h2>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <li>
            <Link href="/admin">index</Link>
          </li>
          <li>
            <Link href="/admin/env">env</Link>
          </li>
          <li>
            <Link href="/admin/renderer">renderer</Link>
          </li>
          <li>
            <Link href="/admin/models">models</Link>
          </li>
          <li>
            <Link href="/admin/storage">storage</Link>
          </li>
          <li>
            <Link href="/admin/db">db</Link>
          </li>
          <li>
            <Link href="/admin/tiles">tiles</Link>
          </li>
          <li>
            <Link href="/admin/pipeline">pipeline</Link>
          </li>
        </ul>
      </aside>
      <main style={{ padding: 32 }}>{children}</main>
    </div>
  );
}
