import { notFound } from "next/navigation";
import ServiceLandingPage from "@/components/services/ServiceLandingPage";
import { servicePageFor, servicePages } from "@/lib/content/servicePages";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export function generateStaticParams() {
  return servicePages.map((page) => ({ slug: page.it.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const entry = servicePageFor("it", slug);
  if (!entry) return {};

  return buildPublicPageMetadata({
    locale: "it",
    title: entry.it.title,
    description: entry.it.description,
    path: `/servizi/${entry.it.slug}`,
    italianPath: `/servizi/${entry.it.slug}`,
    englishPath: `/en/services/${entry.en.slug}`,
  });
}

export default async function ItalianServicePage({ params }) {
  const { slug } = await params;
  const entry = servicePageFor("it", slug);
  if (!entry) notFound();
  return <ServiceLandingPage entry={entry} locale="it" />;
}
