'use client';
import dynamic from 'next/dynamic';

// Wallet provider touches window at import time, so the page renders client-side only.
const App = dynamic(() => import('@/components/Home.tsx').then((m) => m.App), { ssr: false });

export default function Page() {
  return <App />;
}
