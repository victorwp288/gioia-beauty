import "../../globals.css";
import PublicDocument from "@/components/layout/PublicDocument";

const isProduction = process.env.NEXT_PUBLIC_APP_ENV === "production";

export const metadata = {
  metadataBase: new URL("https://www.gioiabeauty.net"),
  title: {
    template: "%s - Gioia Beauty",
    default: "Gioia Beauty | Beauty salon near Piacenza",
  },
  description:
    "Eco-conscious beauty salon in Roveleto di Cadeo offering face and body treatments, manicure, pedicure and massage with vegan and organic products.",
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
    title: "Gioia Beauty | Eco-conscious beauty salon",
    description:
      "Personalised beauty treatments with vegan and organic products in Roveleto di Cadeo, near Piacenza.",
    url: "/en",
    images: [
      {
        url: "/ogimage.png",
        width: 1200,
        height: 630,
        alt: "Gioia Beauty salon",
      },
    ],
    siteName: "Gioia Beauty",
    locale: "en_GB",
    alternateLocale: ["it_IT"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Gioia Beauty | Beauty salon near Piacenza",
    description:
      "Eco-conscious beauty treatments with vegan and organic products.",
    images: ["/ogimage.png"],
  },
};

export const viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function EnglishPublicLayout({ children }) {
  return <PublicDocument locale="en">{children}</PublicDocument>;
}
