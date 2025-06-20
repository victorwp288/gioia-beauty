import { Inter, Bricolage_Grotesque, DM_Serif_Display } from "next/font/google";
import "./globals.css";
import ConditionalLayout from "@/components/layout/ConditionalLayout";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AppointmentProvider } from "@/context/AppointmentContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { ThemeProvider } from "@/context/ThemeContext";

const inter = Inter({ 
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

export const metadata = {
  title: {
    template: "%s - Gioia Beauty",
    default: "Gioia Beauty - Centro Estetico Eco-Sostenibile Roveleto",
  },
  description:
    "Centro estetico eco-sostenibile a Roveleto di Cadeo specializzato in trattamenti viso, corpo, manicure, pedicure e massaggi con prodotti vegani e biologici.",
  keywords:
    "centro estetico roveleto cadeo, gioia beauty, trattamenti estetici piacenza, eco sostenibile, vegano, biologico",
  authors: [{ name: "Gioia Beauty" }],
  creator: "Gioia Beauty",
  publisher: "Gioia Beauty",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "80C0DA0047C69C3845952ED707A5C88C",
  },
  openGraph: {
    title: "Gioia Beauty - Centro Estetico Eco-Sostenibile",
    description:
      "Centro estetico specializzato in trattamenti estetici eco-sostenibili con prodotti vegani e biologici a Roveleto di Cadeo",
    url: "https://www.gioiabeauty.net/",
    images: [
      {
        url: "https://www.gioiabeauty.net/ogimage.png",
        width: 1200,
        height: 630,
        alt: "Centro Estetico Gioia Beauty",
      },
    ],
    siteName: "Gioia Beauty",
    locale: "it_IT",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Gioia Beauty - Centro Estetico Eco-Sostenibile",
    description:
      "Trattamenti estetici eco-sostenibili con prodotti vegani e biologici",
    images: ["https://www.gioiabeauty.net/ogimage.png"],
  },
  alternates: {
    canonical: "https://www.gioiabeauty.net/",
    languages: {
      it: "https://www.gioiabeauty.net/",
    },
  },
};

export const bricolage = Bricolage_Grotesque({
  weight: ["400", "500", "600", "700"], // Reduced font weights for better performance
  style: "normal",
  display: "swap",
  subsets: ["latin"],
  variable: "--bricolage",
  preload: true,
});

export const dmSerif = DM_Serif_Display({
  weight: ["400"],
  style: "normal",
  display: "swap",
  subsets: ["latin"],
  variable: "--serif",
  preload: true,
});

export default function RootLayout({ children }) {
  return (
    <html
      lang="it"
      className={`${bricolage.variable} ${dmSerif.variable} font-bricolage h-full scroll-smooth antialiased`}
    >
      <head>
        <meta name="msvalidate.01" content="80C0DA0047C69C3845952ED707A5C88C" />
        <link rel="preconnect" href="https://va.vercel-scripts.com" />
        <link rel="dns-prefetch" href="https://vercel-scripts.com" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": ["BeautySalon", "LocalBusiness"],
              name: "Gioia Beauty",
              description:
                "Centro estetico specializzato in trattamenti viso, corpo, manicure, pedicure e massaggi a Roveleto di Cadeo",
              image: "https://www.gioiabeauty.net/ogimage.png",
              logo: "https://www.gioiabeauty.net/ogimage.png",
              url: "https://www.gioiabeauty.net",
              telephone: "+393914213634",
              email: "gioiabeautyy@gmail.com",
              priceRange: "$$",
              address: {
                "@type": "PostalAddress",
                streetAddress: "Via Emilia 60",
                addressLocality: "Roveleto di Cadeo",
                addressRegion: "Emilia-Romagna",
                postalCode: "29010",
                addressCountry: "IT",
              },
              geo: {
                "@type": "GeoCoordinates",
                latitude: 44.96556,
                longitude: 9.8514,
              },
              openingHours: [
                "Mo 09:00-19:00",
                "Tu 10:00-20:00",
                "We 09:00-19:00",
                "Th 10:00-20:00",
                "Fr 09:00-18:30",
              ],
              sameAs: ["https://www.instagram.com/gioiabeautyy/"],
              hasOfferCatalog: {
                "@type": "OfferCatalog",
                name: "Servizi Estetici",
                itemListElement: [
                  {
                    "@type": "Offer",
                    itemOffered: {
                      "@type": "Service",
                      name: "Trattamenti Viso",
                      description:
                        "Pulizia viso, trattamenti anti-età e ossigeno dermo infusione",
                    },
                  },
                  {
                    "@type": "Offer",
                    itemOffered: {
                      "@type": "Service",
                      name: "Manicure e Pedicure",
                      description:
                        "Trattamenti unghie, manicure SPA e pedicure completa",
                    },
                  },
                  {
                    "@type": "Offer",
                    itemOffered: {
                      "@type": "Service",
                      name: "Massaggi",
                      description:
                        "Massaggi viso e corpo personalizzati, pressoterapia",
                    },
                  },
                  {
                    "@type": "Offer",
                    itemOffered: {
                      "@type": "Service",
                      name: "Ciglia e Sopracciglia",
                      description:
                        "Laminazione ciglia, architettura sopracciglia, nanoblading",
                    },
                  },
                ],
              },
              founder: {
                "@type": "Person",
                name: "Gioia Castignoli",
                jobTitle: "Estetista Professionista",
              },
              areaServed: {
                "@type": "GeoCircle",
                geoMidpoint: {
                  "@type": "GeoCoordinates",
                  latitude: 44.96556,
                  longitude: 9.8514,
                },
                geoRadius: "50000",
              },
            }),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const darkMode = localStorage.getItem('darkMode');
                  if (darkMode === 'true') {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>

      <body className="bg-white flex h-full flex-col">
        <ThemeProvider>
          <NotificationProvider>
            <AppointmentProvider>
              <ConditionalLayout>{children}</ConditionalLayout>
            </AppointmentProvider>
          </NotificationProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
