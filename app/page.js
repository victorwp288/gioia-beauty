import BookAppointment from "@/components/booking/BookAppointment";
import ServicesContainer from "@/components/services/ServicesContainer";
import HeroSection from "@/components/HeroSection";
import Technologies from "@/components/Technologies";
import AboutUs from "@/components/AboutUs";
import { Cookiesbanner } from "@/components/common/Cookiesbanner";
import NewsletterSignup from "@/components/NewsletterSignup";
import FAQStructuredData from "@/components/seo/FAQStructuredData";

export const metadata = {
  title:
    "Centro Estetico Gioia Beauty - Roveleto di Cadeo | Trattamenti Viso e Corpo",
  description:
    "Centro estetico eco-sostenibile a Roveleto di Cadeo. Trattamenti viso, corpo, manicure, pedicure, massaggi, bagno turco. Prodotti vegani e biologici. Prenota ora!",
  keywords:
    "centro estetico roveleto cadeo, gioia beauty, trattamenti viso piacenza, manicure pedicure, massaggi corpo, estetica ecosostenibile, bagno turco, laminazione ciglia, beauty salon emilia romagna",
  openGraph: {
    title:
      "Centro Estetico Gioia Beauty - Bellezza Eco-Sostenibile a Roveleto di Cadeo",
    description:
      "Scopri i trattamenti estetici eco-sostenibili di Gioia Beauty. Servizi personalizzati con prodotti vegani e biologici nel cuore dell'Emilia Romagna.",
    url: "https://www.gioiabeauty.net/",
    type: "website",
    images: [
      {
        url: "https://www.gioiabeauty.net/ogimage.png",
        width: 1200,
        height: 630,
        alt: "Centro Estetico Gioia Beauty - Trattamenti eco-sostenibili",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Centro Estetico Gioia Beauty - Roveleto di Cadeo",
    description:
      "Trattamenti estetici eco-sostenibili con prodotti vegani e biologici. Prenota il tuo appuntamento!",
    images: ["https://www.gioiabeauty.net/ogimage.png"],
  },
  alternates: {
    canonical: "https://www.gioiabeauty.net/",
  },
};

export default function Home() {
  return (
    <main className="animate-fadeIn bg-white">
      <FAQStructuredData />
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
