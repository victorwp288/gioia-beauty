import Link from "next/link";
import { BUSINESS_INFO } from "@/lib/content/businessInfo";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export const metadata = buildPublicPageMetadata({
  locale: "en",
  title: "Privacy information",
  description:
    "Privacy information for English-speaking visitors to Gioia Beauty.",
  path: "/en/privacy",
  italianPath: "/policy",
  englishPath: "/en/privacy",
  robots: { index: false, follow: false, nocache: true },
});

export default function EnglishPrivacy() {
  return (
    <main className="mx-auto mt-24 w-[90vw] py-10 md:mt-32 md:w-[70vw]">
      <h1 className="font-serif text-3xl font-bold">Privacy information</h1>
      <div className="mt-6 max-w-3xl space-y-4 text-sm leading-7 text-slate-700">
        <p>
          The legally authoritative privacy notice is currently available in
          Italian. This English page is provided to help visitors find and
          understand the correct document; it is not a substitute legal
          translation.
        </p>
        <p>
          The data controller is {BUSINESS_INFO.legalName}. For questions
          about personal data, contact{" "}
          <Link className="underline" href={`mailto:${BUSINESS_INFO.email}`}>
            {BUSINESS_INFO.email}
          </Link>
          .
        </p>
        <Link
          href="/policy"
          hrefLang="it"
          className="inline-flex rounded-sm bg-primary px-5 py-3 font-semibold text-white"
        >
          Read the Italian privacy notice
        </Link>
      </div>
    </main>
  );
}
