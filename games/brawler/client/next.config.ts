import type { NextConfig } from 'next';

export default {
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  transpilePackages: ['@xyz/platform'], // ships raw .ts
  agentRules: false, // don't generate AGENTS.md on dev
  headers: async () => ['ui', 'stages', 'title', 'chars'].map((d) => ({
    source: `/${d}/:path*`,
    headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
  })),
} satisfies NextConfig;
