import type { NextConfig } from "next";

// The Next.js app stays at the repository root because Vercel reads
// vercel.json and app/api/voice/route.ts from that root. XcodeGen only
// compiles the Swift sources listed in project.yml, so this tree is not
// part of the iOS target.
const nextConfig: NextConfig = {
  poweredByHeader: false,
};

export default nextConfig;
