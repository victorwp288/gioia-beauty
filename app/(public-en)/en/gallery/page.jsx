import GalleryClient from "@/components/GalleryClient";
import {
  reception1,
  reception2,
  reception3,
  reception4,
  mirror1,
  mirror2,
  pressoterapia1,
  massaggi1,
  ossigeno,
  bagnoturco1,
  bed,
  rituali1,
} from "@/components/ImagesExports";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export const metadata = buildPublicPageMetadata({
  locale: "en",
  title: "Gallery",
  description:
    "Explore Gioia Beauty’s treatment rooms, relaxation spaces and professional beauty technology in Roveleto di Cadeo.",
  path: "/en/gallery",
  italianPath: "/gallery",
  englishPath: "/en/gallery",
  imageAlt: "Gallery of Gioia Beauty salon and treatment rooms",
});

const images = [
  [reception1, "Reception", "Spazi"],
  [reception2, "Reception", "Spazi"],
  [reception3, "Reception", "Spazi"],
  [reception4, "Entrance", "Spazi"],
  [mirror1, "Beauty details", "Spazi"],
  [mirror2, "Beauty station", "Spazi"],
  [pressoterapia1, "Pressotherapy", "Tecnologie"],
  [massaggi1, "Relaxation area", "Trattamenti"],
  [ossigeno, "Oxygen dermal infusion", "Tecnologie"],
  [bagnoturco1, "Steam bath", "Trattamenti"],
  [bed, "Treatment room", "Trattamenti"],
  [rituali1, "Himalayan ritual", "Trattamenti"],
].map(([src, title, category]) => ({ src, title, category }));

export default function EnglishGallery() {
  return (
    <main className="relative overflow-x-hidden bg-[#f8f5f2] pb-16 pt-24 md:pt-32">
      <div className="mx-auto w-[92vw] max-w-7xl">
        <header className="text-center">
          <p className="text-sm font-medium uppercase tracking-[0.28em] text-[#755e5d]">
            Gioia Beauty
          </p>
          <h1 className="mt-4 font-serif text-4xl text-[#3f3a37] md:text-5xl">
            Gallery
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-[#6f6663] md:text-base">
            Explore the salon, our technology and the atmosphere created for
            your experience at Gioia Beauty.
          </p>
        </header>
        <div className="mt-12">
          <GalleryClient images={images} locale="en" />
        </div>
      </div>
    </main>
  );
}
