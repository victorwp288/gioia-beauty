import AboutUs from "@/components/AboutUs";
import DeferredBookingExperience from "@/components/booking/DeferredBookingExperience";
import { Cookiesbanner } from "@/components/common/Cookiesbanner";
import HeroSection from "@/components/HeroSection";
import FAQSection from "@/components/seo/FAQSection";
import EnglishServices from "@/components/services/EnglishServices";
import Technologies from "@/components/Technologies";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export const metadata = buildPublicPageMetadata({
  locale: "en",
  title: "Gioia Beauty | Beauty salon near Piacenza",
  description:
    "Discover Gioia Beauty in Roveleto di Cadeo: personalised face and body treatments, manicure, pedicure and massage with vegan and organic products.",
  path: "/en",
  italianPath: "/",
  englishPath: "/en",
  absoluteTitle: true,
  imageAlt: "Gioia Beauty salon in Roveleto di Cadeo near Piacenza",
});

export default function EnglishHome() {
  return (
    <main className="bg-white">
      <Cookiesbanner locale="en" />
      <HeroSection locale="en" />
      <div id="about-us" className="scroll-mt-16 overflow-x-hidden bg-white">
        <AboutUs locale="en" />
      </div>
      <div id="technologies" className="scroll-mt-16 bg-[#62747e]">
        <Technologies locale="en" />
      </div>
      <div id="services" className="scroll-mt-16">
        <EnglishServices />
      </div>
      <div className="scroll-mt-16 flow-root" id="booking-section">
        <DeferredBookingExperience locale="en" showNewsletter={false} />
      </div>
      <FAQSection locale="en" />
    </main>
  );
}
