import dynamic from "next/dynamic";
import HeroSection from "@/components/HeroSection";
const Technologies = dynamic(() => import("@/components/Technologies"), {
  loading: () => <div className="h-96 bg-gray-100 animate-pulse" />,
});
const AboutUs = dynamic(() => import("@/components/AboutUs"), {
  loading: () => <div className="h-96 bg-gray-50 animate-pulse" />,
});
import { Cookiesbanner } from "@/components/common/Cookiesbanner";
import FAQStructuredData from "@/components/seo/FAQStructuredData";
import EnhancedStructuredData from "@/components/seo/EnhancedStructuredData";
import BreadcrumbStructuredData from "@/components/seo/BreadcrumbStructuredData";
import { ServicesSkeleton, BookingSkeleton, NewsletterSkeleton } from "@/components/common/LoadingSkeletons";

// Lazy load heavy components that are below the fold with proper skeletons
const ServicesContainer = dynamic(() => import("@/components/services/ServicesContainer"), {
  loading: () => <ServicesSkeleton />,
});

const BookAppointment = dynamic(() => import("@/components/booking/BookAppointment"), {
  loading: () => <BookingSkeleton />,
});

const NewsletterSignup = dynamic(() => import("@/components/NewsletterSignup"), {
  loading: () => <NewsletterSkeleton />,
});

export const metadata = {
  title: "Gioia Beauty - Centro Estetico Roveleto | Trattamenti Viso Corpo",
  description:
    "Centro estetico eco-sostenibile a Roveleto di Cadeo. Trattamenti viso, corpo, manicure, pedicure, massaggi, bagno turco. Prodotti vegani e biologici. Prenota ora!",
  keywords:
    "centro estetico roveleto cadeo, gioia beauty, trattamenti viso piacenza, manicure pedicure, massaggi corpo, estetica ecosostenibile, bagno turco, laminazione ciglia, beauty salon emilia romagna",
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
  openGraph: {
    title:
      "Centro Estetico Gioia Beauty - Bellezza Eco-Sostenibile a Roveleto di Cadeo",
    description:
      "Scopri i trattamenti estetici eco-sostenibili di Gioia Beauty. Servizi personalizzati con prodotti vegani e biologici nel cuore dell'Emilia Romagna.",
    url: "https://www.gioiabeauty.net/",
    siteName: "Gioia Beauty",
    type: "website",
    locale: "it_IT",
    images: [
      {
        url: "https://www.gioiabeauty.net/ogimage.webp",
        width: 1200,
        height: 630,
        alt: "Centro Estetico Gioia Beauty - Trattamenti eco-sostenibili",
        type: "image/webp",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@gioiabeauty",
    creator: "@gioiabeauty",
    title: "Centro Estetico Gioia Beauty - Roveleto di Cadeo",
    description:
      "Trattamenti estetici eco-sostenibili con prodotti vegani e biologici. Prenota il tuo appuntamento!",
    images: ["https://www.gioiabeauty.net/ogimage.webp"],
  },
  alternates: {
    canonical: "https://www.gioiabeauty.net/",
  },
  other: {
    "geo.region": "IT-45",
    "geo.placename": "Roveleto di Cadeo",
    "geo.position": "44.96556;9.8514",
    "ICBM": "44.96556, 9.8514",
  },
};

export default function Home() {
  return (
    <main className="animate-fadeIn bg-white">
      <FAQStructuredData />
      <EnhancedStructuredData />
      <BreadcrumbStructuredData />
      <Cookiesbanner />

      <HeroSection />
      <div id="about-us" className="scroll-mt-16 bg-white overflow-x-hidden">
        <AboutUs />
      </div>
      <div id="technologies" className="scroll-mt-16 bg-[#97a6af]">
        <Technologies />
      </div>

      <div id="services" className="scroll-mt-16">
        <ServicesContainer />
      </div>

      <div className="scroll-mt-16" id="booking-section">
        <BookAppointment />
      </div>

      <div className="scroll-mt-16" id="newletter-section">
        <NewsletterSignup />
      </div>
    </main>
  );
}
