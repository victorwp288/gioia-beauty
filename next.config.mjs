/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image optimization for better performance and Core Web Vitals
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31536000, // 1 year cache for optimized images
    dangerouslyAllowSVG: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  
  // Performance optimizations
  experimental: {
    // optimizeCss: true, // Disabled due to critters dependency issue
  },
  
  // Enable compression
  compress: true,
  
  // Optimize bundle size
  webpack: (config, { dev, isServer }) => {
    // Only optimize in production
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          dashboard: {
            name: 'dashboard',
            test: /[\\/]components[\\/]dashboard[\\/]/,
            priority: 10,
            reuseExistingChunk: true,
          },
          booking: {
            name: 'booking',
            test: /[\\/]components[\\/]booking[\\/]/,
            priority: 10,
            reuseExistingChunk: true,
          },
          firebase: {
            name: 'firebase',
            test: /[\\/]node_modules[\\/]firebase[\\/]/,
            priority: 10,
            reuseExistingChunk: true,
          },
        },
      };
    }
    
    return config;
  },
};

export default nextConfig;
