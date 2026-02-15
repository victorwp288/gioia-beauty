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

export const metadata = {
  title: "Galleria - Centro Estetico Gioia Beauty",
  description:
    "Scopri gli spazi del centro estetico Gioia Beauty a Roveleto di Cadeo. Sala trattamenti, bagno turco, area relax e attrezzature professionali per la tua bellezza.",
  keywords:
    "galleria gioia beauty, centro estetico roveleto, spa piacenza, trattamenti estetici, bagno turco, pressoterapia",
  openGraph: {
    title: "Galleria - Centro Estetico Gioia Beauty",
    description:
      "Scopri gli spazi del centro estetico Gioia Beauty a Roveleto di Cadeo. Sala trattamenti, bagno turco, area relax.",
    images: [
      {
        url: "https://www.gioiabeauty.net/ogimage.png",
        width: 1200,
        height: 630,
        alt: "Galleria centro estetico Gioia Beauty",
      },
    ],
  },
};

const Gallery = () => {
  const galleryImages = [
    {
      src: reception1,
      title: "Reception",
      category: "Spazi",
    },
    {
      src: reception2,
      title: "Reception",
      category: "Spazi",
    },
    {
      src: reception3,
      title: "Reception",
      category: "Spazi",
    },
    {
      src: reception4,
      title: "Ingresso",
      category: "Spazi",
    },
    {
      src: mirror1,
      title: "Dettagli Beauty",
      category: "Spazi",
    },
    {
      src: mirror2,
      title: "Postazione",
      category: "Spazi",
    },
    {
      src: pressoterapia1,
      title: "Pressoterapia",
      category: "Tecnologie",
    },
    {
      src: massaggi1,
      title: "Area Relax",
      category: "Trattamenti",
    },
    {
      src: ossigeno,
      title: "Ossigeno Dermo Infusione",
      category: "Tecnologie",
    },
    {
      src: bagnoturco1,
      title: "Bagno Turco",
      category: "Trattamenti",
    },
    {
      src: bed,
      title: "Cabina Trattamenti",
      category: "Trattamenti",
    },
    {
      src: rituali1,
      title: "Rituale Himalaya",
      category: "Trattamenti",
    },
  ];

  return (
    <main className="relative overflow-x-hidden bg-[#f8f5f2] pb-16 pt-24 md:pt-32">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-24 h-64 w-64 rounded-full bg-[#d8b8bc]/35 blur-3xl" />
        <div className="absolute right-0 top-8 h-72 w-72 rounded-full bg-[#97a6af]/25 blur-3xl" />
      </div>

      <div className="mx-auto w-[92vw] max-w-7xl">
        <div className="animate-fadeIn text-center">
          <p className="text-sm font-medium uppercase tracking-[0.28em] text-[#a18488]">
            Gioia Beauty
          </p>
          <h1 className="mt-4 font-serif text-4xl text-[#3f3a37] md:text-5xl">
            Galleria
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-[#6f6663] md:text-base">
            Scopri i nostri ambienti, le tecnologie e l&apos;atmosfera del
            centro. Una selezione di immagini pensata per raccontare la tua
            esperienza in Gioia Beauty.
          </p>
        </div>

        <div className="mt-12">
          <GalleryClient images={galleryImages} />
        </div>
      </div>
    </main>
  );
};

export default Gallery;
