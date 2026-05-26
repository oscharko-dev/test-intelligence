/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  transpilePackages: [
    "@oscharko-dev/ti-agentic-harness",
    "@oscharko-dev/ti-cli",
    "@oscharko-dev/ti-contracts",
    "@oscharko-dev/ti-core-engine",
    "@oscharko-dev/ti-eval",
    "@oscharko-dev/ti-evidence",
    "@oscharko-dev/ti-integrations",
    "@oscharko-dev/ti-model-gateway",
    "@oscharko-dev/ti-multi-source",
    "@oscharko-dev/ti-production-runner",
    "@oscharko-dev/ti-quality",
    "@oscharko-dev/ti-review",
    "@oscharko-dev/ti-security",
    "@oscharko-dev/ti-tenant",
    "is-path-inside",
  ],
};

export default nextConfig;
