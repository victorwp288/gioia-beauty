export default function robots() {
  const isProduction = process.env.NEXT_PUBLIC_APP_ENV === "production";

  return {
    rules: isProduction
      ? [
          {
            userAgent: "*",
            allow: "/",
            disallow: [
              "/api/",
              "/login",
              "/dashboard",
              "/export",
              "/newsletter/",
            ],
          },
        ]
      : [{ userAgent: "*", disallow: "/" }],
    sitemap: "https://www.gioiabeauty.net/sitemap.xml",
  };
}
