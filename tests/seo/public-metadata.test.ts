import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import robots from "../../app/robots.js";
import sitemap from "../../app/sitemap.js";
import {
  BUSINESS_INFO,
  formattedAddress,
  schemaOpeningHours,
} from "../../lib/content/businessInfo.js";
import { buildBusinessStructuredData } from "../../lib/content/businessStructuredData.js";
import { buildPublicPageMetadata } from "../../lib/content/seoMetadata.js";
import { servicePages } from "../../lib/content/servicePages.js";

describe("public SEO contracts", () => {
  it("emits stable bilingual sitemap entries with reciprocal alternates", () => {
    const entries = sitemap();

    expect(entries).toHaveLength(8 + servicePages.length * 2);
    expect(entries.map((entry) => entry.url).slice(0, 8)).toEqual([
      "https://www.gioiabeauty.net",
      "https://www.gioiabeauty.net/en",
      "https://www.gioiabeauty.net/contacts",
      "https://www.gioiabeauty.net/en/contacts",
      "https://www.gioiabeauty.net/gallery",
      "https://www.gioiabeauty.net/en/gallery",
      "https://www.gioiabeauty.net/servizi",
      "https://www.gioiabeauty.net/en/services",
    ]);
    for (const page of servicePages) {
      expect(entries.map((entry) => entry.url)).toContain(
        `https://www.gioiabeauty.net/servizi/${page.it.slug}`,
      );
      expect(entries.map((entry) => entry.url)).toContain(
        `https://www.gioiabeauty.net/en/services/${page.en.slug}`,
      );
    }

    for (const entry of entries) {
      expect(entry).toHaveProperty("changeFrequency");
      expect(entry).not.toHaveProperty("changefreq");
      expect(entry).not.toHaveProperty("lastModified");
      expect(entry.alternates.languages).toMatchObject({
        "it-IT": expect.stringContaining("gioiabeauty.net"),
        en: expect.stringContaining("gioiabeauty.net/en"),
        "x-default": expect.stringContaining("gioiabeauty.net"),
      });
      expect(entry.url).not.toContain("policy");
    }
  });

  it("builds complete route-specific Open Graph and Twitter metadata", () => {
    const metadata = buildPublicPageMetadata({
      locale: "en",
      title: "Face treatments near Piacenza",
      description: "A route-specific description.",
      path: "/en/services/face-treatments",
      italianPath: "/servizi/trattamenti-viso",
      englishPath: "/en/services/face-treatments",
    });

    expect(metadata.alternates).toEqual({
      canonical: "/en/services/face-treatments",
      languages: {
        "it-IT": "/servizi/trattamenti-viso",
        en: "/en/services/face-treatments",
        "x-default": "/servizi/trattamenti-viso",
      },
    });
    expect(metadata.openGraph).toMatchObject({
      title: "Face treatments near Piacenza | Gioia Beauty",
      description: "A route-specific description.",
      url: "/en/services/face-treatments",
      siteName: "Gioia Beauty",
      locale: "en_GB",
      alternateLocale: ["it_IT"],
      type: "website",
      images: [
        {
          url: "/ogimage.png",
          width: 1200,
          height: 630,
          alt: expect.any(String),
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Face treatments near Piacenza | Gioia Beauty",
      description: "A route-specific description.",
      images: [
        {
          url: "/ogimage.png",
          width: 1200,
          height: 630,
          alt: expect.any(String),
        },
      ],
    });
  });

  it("keeps one verified Via Emilia 60 business record for visible and schema use", () => {
    expect(BUSINESS_INFO.address).toMatchObject({
      street: "Via Emilia 60",
      postalCode: "29010",
      locality: "Roveleto di Cadeo",
      province: "PC",
      country: "IT",
    });
    expect(formattedAddress()).toBe(
      "Via Emilia 60, 29010 Roveleto di Cadeo (PC)",
    );
    expect(formattedAddress({ legal: true })).toContain("Via Emilia 60");
    expect(schemaOpeningHours()).toEqual([
      "Mo 09:00-19:00",
      "We 09:00-19:00",
      "Tu 10:00-20:00",
      "Th 10:00-20:00",
      "Fr 09:00-18:30",
    ]);
    const italianSchema = buildBusinessStructuredData("it");
    const englishSchema = buildBusinessStructuredData("en");
    for (const schema of [italianSchema, englishSchema]) {
      expect(schema).toMatchObject({
        "@type": "BeautySalon",
        "@id": "https://www.gioiabeauty.net/#business",
        name: "Gioia Beauty",
        url: "https://www.gioiabeauty.net",
        image: "https://www.gioiabeauty.net/ogimage.png",
        logo: "https://www.gioiabeauty.net/logo.png",
        telephone: "+393914213634",
        email: "gioiabeautyy@gmail.com",
        address: {
          streetAddress: "Via Emilia 60",
          postalCode: "29010",
          addressLocality: "Roveleto di Cadeo",
        },
      });
    }

    const napFiles = [
      "app/(public-it)/policy/page.jsx",
      "app/(public-it)/contacts/page.jsx",
      "app/(public-en)/en/contacts/page.jsx",
      "components/layout/Footer.jsx",
      "components/layout/PublicDocument.jsx",
      "components/seo/FAQSection.jsx",
      "lib/utils/constants.js",
    ];
    for (const path of napFiles) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).not.toContain("Via Emilia 58");
      expect(source).not.toContain("Via Roma 123");
    }
  });

  it("keeps service landing content and structured navigation complete", () => {
    for (const page of servicePages) {
      for (const locale of ["it", "en"] as const) {
        expect(page[locale].catalogIntro.length).toBeGreaterThan(20);
        expect(page[locale].treatments.length).toBeGreaterThan(0);
        for (const [name, duration] of page[locale].treatments) {
          if (!name || !duration) {
            throw new Error(`Incomplete ${locale} treatment metadata`);
          }
          expect(name.length).toBeGreaterThan(2);
          expect(duration).toMatch(/min/u);
        }
      }
    }

    const source = readFileSync(
      join(process.cwd(), "components/services/ServiceLandingPage.jsx"),
      "utf8",
    );
    expect(source).toContain('"@type": "BreadcrumbList"');
    expect(source).toContain('"@type": "Service"');
    expect(source).toContain('provider: { "@id": `${SITE_URL}/#business` }');
    expect(source).toContain('aria-current="page"');
  });

  it("blocks crawling outside the production environment", () => {
    const original = process.env.NEXT_PUBLIC_APP_ENV;
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    try {
      expect(robots().rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    } finally {
      process.env.NEXT_PUBLIC_APP_ENV = original;
    }
  });

  it("keeps localized pages self-canonical with reciprocal hreflang", () => {
    const pagePaths = [
      "app/(public-it)/page.js",
      "app/(public-it)/contacts/page.jsx",
      "app/(public-it)/gallery/page.jsx",
      "app/(public-it)/servizi/page.js",
      "app/(public-en)/en/page.js",
      "app/(public-en)/en/contacts/page.jsx",
      "app/(public-en)/en/gallery/page.jsx",
      "app/(public-en)/en/services/page.js",
    ];

    for (const pagePath of pagePaths) {
      const source = readFileSync(join(process.cwd(), pagePath), "utf8");
      expect(source).toContain("buildPublicPageMetadata");
    }
  });

  it("renders FAQ copy and FAQ schema from the same localized source", () => {
    const faqSource = readFileSync(
      join(process.cwd(), "components/seo/FAQSection.jsx"),
      "utf8",
    );

    expect(faqSource).toContain('"@type": "FAQPage"');
    expect(faqSource).toContain("faq.map");
    expect(faqSource).toContain("<details");
    expect(faqSource).not.toContain("servizi per la sposa");
  });
});
