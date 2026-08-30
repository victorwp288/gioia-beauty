import Link from "next/link";
import Image from "next/image";
import downArrow from "@/images/down-arrow.svg";
import { reception4 } from "@/components/ImagesExports";

const content = {
  it: {
    eyebrow: "Centro estetico a Roveleto di Cadeo",
    title: "Bellezza consapevole, pensata per te",
    description:
      "Trattamenti viso e corpo personalizzati con prodotti vegani, biologici e di alta qualità, nel rispetto della pelle, degli animali e dell’ambiente.",
    book: "PRENOTA",
    services: "Scopri i nostri servizi",
    alt: "Interno del centro estetico Gioia Beauty a Roveleto di Cadeo",
  },
  en: {
    eyebrow: "Beauty salon in Roveleto di Cadeo",
    title: "Thoughtful beauty, tailored to you",
    description:
      "Personalised face and body treatments with high-quality vegan and organic products, chosen with care for your skin, animals and the environment.",
    book: "BOOK NOW",
    services: "Explore our treatments",
    alt: "Interior of Gioia Beauty salon in Roveleto di Cadeo",
  },
};

function HeroSection({ locale = "it" }) {
  const copy = content[locale] || content.it;
  const prefix = locale === "en" ? "/en" : "";
  return (
    <div className=" relative  h-screen bg-cover bg-center  md:mt-10 md:h-[95vh]">
      <Image
        className="h-full w-full object-cover"
        src={reception4}
        alt={copy.alt}
        fill
        sizes="100vw"
        preload
      />
      <div className="absolute inset-0 flex items-center">
        <div className="absolute inset-0 bg-linear-to-t from-zinc-900/80 from-10% to-transparent"></div>
        <div className="relative flex flex-col gap-8 p-6 md:pl-12">
          <div className="max-w-3xl text-white">
            <p className="text-xs font-bold uppercase tracking-[0.2em] md:text-sm">
              {copy.eyebrow}
            </p>
            <h1 className="mt-3 font-serif text-4xl leading-tight md:text-6xl">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 md:text-lg">
              {copy.description}
            </p>
          </div>
          <div className="flex flex-col gap-6">
            <Link
              href={`${prefix}/#booking-section`}
              className="w-fit cursor-pointer border border-white p-4 text-base font-medium text-white "
            >
              {copy.book}
            </Link>
            <div className="flex items-center gap-2">
              <Link
                href={`${prefix}/#services`}
                className="w-fit cursor-pointer   text-sm font-medium text-white "
              >
                {copy.services}
              </Link>
              <Image
                src={downArrow}
                alt=""
                width={16}
                height={16}
                style={{
                  maxWidth: "100%",
                  height: "auto",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HeroSection;
