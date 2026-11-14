import type { NextConfig } from 'next';

export default {
  output: 'export',
  transpilePackages: ['@xyz/platform'], // ships raw .ts
  agentRules: false, // don't generate AGENTS.md on dev
} satisfies NextConfig;
