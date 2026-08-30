import FullServiceCatalog from "@/components/services/FullServiceCatalog";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export const metadata = buildPublicPageMetadata({
  locale: "it",
  title: "Trattamenti e servizi",
  description:
    "Consulta il catalogo completo dei trattamenti Gioia Beauty a Roveleto di Cadeo: viso, corpo, manicure, pedicure, massaggi, laser e benessere.",
  path: "/servizi",
  italianPath: "/servizi",
  englishPath: "/en/services",
});

export default function ItalianServiceCatalogPage() {
  return <FullServiceCatalog locale="it" />;
}
