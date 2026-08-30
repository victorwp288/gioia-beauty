import DeferredBookingExperience from "@/components/booking/DeferredBookingExperience";
import ServicesContainer from "@/components/services/ServicesContainer";
import ServiceHighlights from "@/components/services/ServiceHighlights";
import HeroSection from "@/components/HeroSection";
import Technologies from "@/components/Technologies";
import AboutUs from "@/components/AboutUs";
import { Cookiesbanner } from "@/components/common/Cookiesbanner";
import FAQSection from "@/components/seo/FAQSection";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export const metadata = buildPublicPageMetadata({
  locale: "it",
  title: "Gioia Beauty | Centro estetico a Roveleto di Cadeo",
  description:
    "Centro estetico eco-sostenibile a Roveleto di Cadeo. Trattamenti viso, corpo, manicure, pedicure, massaggi e bagno turco con prodotti vegani e biologici.",
  path: "/",
  italianPath: "/",
  englishPath: "/en",
  absoluteTitle: true,
  imageAlt: "Centro estetico Gioia Beauty a Roveleto di Cadeo",
});

export default function Home() {
  return (
    <main className="bg-white">
      <Cookiesbanner locale="it" />

      <HeroSection />
      <div id="about-us" className="scroll-mt-16 bg-white overflow-x-hidden">
        <AboutUs />
      </div>
      <div id="technologies" className="scroll-mt-16 bg-[#62747e]">
        <Technologies />
      </div>

      <div id="services" className="scroll-mt-16">
        <ServicesContainer />
        <ServiceHighlights />
      </div>

      <div className="scroll-mt-16 flow-root" id="booking-section">
        <DeferredBookingExperience />
      </div>
      <FAQSection locale="it" />
    </main>
  );
}
