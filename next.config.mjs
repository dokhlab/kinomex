/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev }) {
    if (dev) {
      // This repository may live in iCloud Drive. Webpack's on-disk pack
      // cache performs rename/stat sequences that cloud sync can interrupt,
      // leaving missing *.pack.gz files. Keep the disposable development
      // cache in memory so source files and application data are unaffected.
      config.cache = { type: "memory" };
    }
    return config;
  },
};

export default nextConfig;
