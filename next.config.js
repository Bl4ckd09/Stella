/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pg is a server-only dependency; never bundle it for the browser
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Anti-clickjacking: stop other sites embedding Stella in an iframe.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Lock down powerful features; keep microphone for the voice widget.
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
