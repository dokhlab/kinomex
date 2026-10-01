/** @type {import('next').NextConfig} */
const nextConfig = {
  // A separate preview server (for example against a copy database) sets its own
  // build directory so it never shares .next with the production or dev server.
  distDir: process.env.KINOMEX_DIST_DIR || ".next",
};

export default nextConfig;
