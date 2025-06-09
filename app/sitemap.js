export default function sitemap() {
  const baseUrl = "https://www.gioiabeauty.net";

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changefreq: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/contacts`,
      lastModified: new Date(),
      changefreq: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/gallery`,
      lastModified: new Date(),
      changefreq: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/policy`,
      lastModified: new Date(),
      changefreq: "yearly",
      priority: 0.3,
    },
  ];
}
