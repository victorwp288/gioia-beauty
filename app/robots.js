export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/gallery", "/contacts", "/policy"],
        disallow: ["/login", "/dashboard", "/export"],
      },
    ],
    sitemap: "https://www.gioiabeauty.net/sitemap.xml",
  };
}
