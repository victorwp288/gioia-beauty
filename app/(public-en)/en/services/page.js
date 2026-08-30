import FullServiceCatalog from "@/components/services/FullServiceCatalog";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export const metadata = buildPublicPageMetadata({
  locale: "en",
  title: "Treatments and services",
  description:
    "Explore Gioia Beauty’s complete treatment catalogue in Roveleto di Cadeo, including face and body care, nails, massage, laser and wellness.",
  path: "/en/services",
  italianPath: "/servizi",
  englishPath: "/en/services",
});

export default function EnglishServiceCatalogPage() {
  return <FullServiceCatalog locale="en" />;
}
