import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const githubPagesBasePath = '/sim-report-stavian';

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        output: 'export' as const,
        assetPrefix: githubPagesBasePath,
      }
    : {}),
  env: { NEXT_PUBLIC_BASE_PATH: isGitHubPages ? githubPagesBasePath : '' },
};

export default nextConfig;
