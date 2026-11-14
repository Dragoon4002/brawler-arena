import type { NextConfig } from "next";

export default {
  output: "standalone",
  reactCompiler: true,
  devIndicators: false,
  agentRules: false,
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
} satisfies NextConfig;
