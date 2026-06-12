/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pg is a server-only dependency; never bundle it for the browser
  serverExternalPackages: ["pg"],
};

module.exports = nextConfig;
