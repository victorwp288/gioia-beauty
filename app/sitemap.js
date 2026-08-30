import { servicePages } from "../lib/content/servicePages.js";

const baseUrl = "https://www.gioiabeauty.net";

const routes = [
  ["", "", "weekly", 1],
  ["/contacts", "/en/contacts", "monthly", 0.9],
  ["/gallery", "/en/gallery", "monthly", 0.8],
  ["/servizi", "/en/services", "monthly", 0.9],
  ...servicePages.map((page) => [
    `/servizi/${page.it.slug}`,
    `/en/services/${page.en.slug}`,
    "monthly",
    0.8,
  ]),
];

export default function sitemap() {
  return routes.flatMap(
    ([italianPath, englishPath, changeFrequency, priority]) => {
      const italianUrl = `${baseUrl}${italianPath}`;
      const englishUrl = `${baseUrl}${englishPath || "/en"}`;
      const languages = {
        "it-IT": italianUrl,
        en: englishUrl,
        "x-default": italianUrl,
      };

      return [
        {
          url: italianUrl,
          changeFrequency,
          priority,
          alternates: { languages },
        },
        {
          url: englishUrl,
          changeFrequency,
          priority: Math.max(priority - 0.1, 0.1),
          alternates: { languages },
        },
      ];
    },
  );
}
