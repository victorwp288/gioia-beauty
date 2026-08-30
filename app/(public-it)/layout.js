import "../globals.css";
import PublicDocument from "@/components/layout/PublicDocument";

const isProduction = process.env.NEXT_PUBLIC_APP_ENV === "production";

export const metadata = {
  metadataBase: new URL("https://www.gioiabeauty.net"),
  title: {
    template: "%s - Gioia Beauty",
    default: "Gioia Beauty | Centro estetico a Roveleto di Cadeo",
  },
  description:
    "Centro estetico eco-sostenibile a Roveleto di Cadeo: trattamenti viso e corpo, manicure, pedicure e massaggi con prodotti vegani e biologici.",
  authors: [{ name: "Gioia Beauty" }],
  creator: "Gioia Beauty",
  publisher: "Gioia Beauty",
  robots: {
    index: isProduction,
    follow: isProduction,
    nocache: !isProduction,
    googleBot: {
      index: isProduction,
      follow: isProduction,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "80C0DA0047C69C3845952ED707A5C88C",
    other: {
      "msvalidate.01": "80C0DA0047C69C3845952ED707A5C88C",
    },
  },
  openGraph: {
    title: "Gioia Beauty | Centro estetico eco-sostenibile",
    description:
      "Trattamenti estetici personalizzati con prodotti vegani e biologici a Roveleto di Cadeo.",
    url: "/",
    images: [
      {
        url: "/ogimage.png",
        width: 1200,
        height: 630,
        alt: "Centro estetico Gioia Beauty",
      },
    ],
    siteName: "Gioia Beauty",
    locale: "it_IT",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Gioia Beauty | Centro estetico a Roveleto di Cadeo",
    description:
      "Trattamenti estetici eco-sostenibili con prodotti vegani e biologici.",
    images: ["/ogimage.png"],
  },
};

export const viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function ItalianPublicLayout({ children }) {
  return <PublicDocument locale="it">{children}</PublicDocument>;
}
