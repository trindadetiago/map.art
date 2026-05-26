import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1 style={{ margin: 0 }}>map.art</h1>
      <p style={{ opacity: 0.7 }}>Pixel-art map tool.</p>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8, marginTop: 24 }}>
        <li>
          <Link href="/projects" style={{ fontSize: 16 }}>
            /projects
          </Link>
          <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 14 }}>
            — list, create, render maps
          </span>
        </li>
        <li>
          <Link href="/admin" style={{ fontSize: 16 }}>
            /admin
          </Link>
          <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 14 }}>
            — dev hub for individual package panels
          </span>
        </li>
      </ul>
    </main>
  );
}
