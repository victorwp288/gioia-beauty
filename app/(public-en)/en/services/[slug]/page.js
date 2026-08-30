import { notFound } from "next/navigation";
import ServiceLandingPage from "@/components/services/ServiceLandingPage";
import { servicePageFor, servicePages } from "@/lib/content/servicePages";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export function generateStaticParams() {
  return servicePages.map((page) => ({ slug: page.en.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const entry = servicePageFor("en", slug);
  if (!entry) return {};

  return buildPublicPageMetadata({
    locale: "en",
    title: entry.en.title,
    description: entry.en.description,
    path: `/en/services/${entry.en.slug}`,
    italianPath: `/servizi/${entry.it.slug}`,
    englishPath: `/en/services/${entry.en.slug}`,
  });
}

export default async function EnglishServicePage({ params }) {
  const { slug } = await params;
  const entry = servicePageFor("en", slug);
  if (!entry) notFound();
  return <ServiceLandingPage entry={entry} locale="en" />;
}
