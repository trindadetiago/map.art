import Link from 'next/link';
import type { ReactNode } from 'react';

export default function DebugLayout({ children }: { children: ReactNode }) {
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
          debug
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
            <Link href="/debug">index</Link>
          </li>
          <li>
            <Link href="/debug/env">env</Link>
          </li>
          <li>
            <Link href="/debug/renderer">renderer</Link>
          </li>
          <li>
            <Link href="/debug/models">models</Link>
          </li>
          <li>
            <Link href="/debug/storage">storage</Link>
          </li>
          <li>
            <Link href="/debug/db">db</Link>
          </li>
          <li>
            <Link href="/debug/tiles">tiles</Link>
          </li>
          <li>
            <Link href="/debug/pipeline">pipeline</Link>
          </li>
        </ul>
      </aside>
      <main style={{ padding: 32 }}>{children}</main>
    </div>
  );
}
