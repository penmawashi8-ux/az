/** @type {import('next').NextConfig} */
// GitHub Pages 用ビルドでは PAGES_BASE_PATH=/az を渡す（Vercel等では空）
const basePath = process.env.PAGES_BASE_PATH || ''

const nextConfig = {
  output: 'export',
  basePath,
  trailingSlash: !!basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
}

export default nextConfig
