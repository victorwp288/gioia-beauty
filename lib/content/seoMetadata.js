import { SITE_URL } from "@/lib/content/businessInfo";

const SOCIAL_IMAGE = {
  url: "/ogimage.png",
  width: 1200,
  height: 630,
};

function socialTitle(title) {
  return title.includes("Gioia Beauty") ? title : `${title} | Gioia Beauty`;
}

export function localizedAlternates(canonicalPath, italianPath, englishPath) {
  return {
    canonical: canonicalPath,
    languages: {
      "it-IT": italianPath,
      en: englishPath,
      "x-default": italianPath,
    },
  };
}

export function buildPublicPageMetadata({
  locale,
  title,
  description,
  path,
  italianPath,
  englishPath,
  imageAlt = undefined,
  absoluteTitle = false,
  robots = undefined,
}) {
  const english = locale === "en";
  const resolvedTitle = socialTitle(title);
  const image = {
    ...SOCIAL_IMAGE,
    alt:
      imageAlt ||
      (english
        ? "Gioia Beauty beauty salon in Roveleto di Cadeo"
        : "Centro estetico Gioia Beauty a Roveleto di Cadeo"),
  };

  return {
    metadataBase: new URL(SITE_URL),
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(robots ? { robots } : {}),
    alternates: localizedAlternates(path, italianPath, englishPath),
    openGraph: {
      title: resolvedTitle,
      description,
      url: path,
      siteName: "Gioia Beauty",
      locale: english ? "en_GB" : "it_IT",
      alternateLocale: [english ? "it_IT" : "en_GB"],
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedTitle,
      description,
      images: [image],
    },
  };
}
