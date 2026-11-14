'use client';
import dynamic from 'next/dynamic';

const GodotApp = dynamic(() => import('@/components/App.tsx').then((m) => m.GodotApp), { ssr: false });

export default function Page() {
  return <GodotApp />;
}
