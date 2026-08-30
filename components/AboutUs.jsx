import React from "react";
import Image from "next/image";
import { portraitSquare } from "./ImagesExports";

const content = {
  it: {
    eyebrow: "SCOPRI",
    title: "Come nasce Gioia Beauty",
    paragraphs: [
      "Ciao! Sono Gioia, nata nel 2003 e da sempre appassionata del mondo dell’estetica.",
      "Questa passione mi ha accompagnata fin da bambina e nel 2019 mi ha portata all’Enaip di Piacenza, dove ho frequentato il biennio di estetica.",
      "A 18 anni ho continuato la formazione alla Diadema Academy, approfondendo gli studi e lavorando prima a Milano e poi in un centro estetico nella provincia di Parma.",
      "Dopo il diploma con specializzazione e il massimo dei voti, ho ottenuto anche l’attestato di make-up artist e hairstylist presso l’Accademia MUD di Milano.",
      "L’esperienza e la formazione continua mi hanno permesso di creare un ambiente accogliente e servizi di qualità, con prodotti biologici e vegani e strumenti riutilizzabili e riciclabili.",
    ],
    alt: "Ritratto di Gioia Castignoli, fondatrice di Gioia Beauty",
  },
  en: {
    eyebrow: "DISCOVER",
    title: "The story behind Gioia Beauty",
    paragraphs: [
      "Hi, I’m Gioia. I was born in 2003 and have always been passionate about beauty and wellbeing.",
      "That passion led me to study beauty therapy at Enaip in Piacenza in 2019.",
      "At 18 I continued my training at Diadema Academy while gaining professional experience first in Milan and later at a beauty salon in the province of Parma.",
      "I graduated with a specialisation and top marks, then qualified as a make-up artist and hairstylist at MUD Academy in Milan.",
      "With this experience and ongoing training, I created a welcoming salon focused on high-quality care, organic and vegan products, and reusable or recyclable tools wherever possible.",
    ],
    alt: "Portrait of Gioia Castignoli, founder of Gioia Beauty",
  },
};

function AboutUs({ locale = "it" }) {
  const copy = content[locale] || content.it;
  return (
    <div className="flex flex-col md:flex-row md:w-screen h-auto md:h-screen">
      <div className="flex-1 shrink-0 md:p-[5%] md:py-8 py-10 overflow-auto">
        <div className="flex flex-col gap-2 py-2 pb-6 md:gap-4 md:py-4  px-5">
          <p className="text-xs font-extrabold text-[#76575c]">
            {copy.eyebrow}
          </p>
          <h2 className="font-serif text-3xl font-bold tracking-tight md:text-3xl">
            {copy.title}
          </h2>
        </div>
        <p className="text-sm md:w-full  px-5">{copy.paragraphs[0]}</p>
        <p className="text-sm md:w-full mt-4  px-5">{copy.paragraphs[1]}</p>
        <p className="text-sm md:w-full mt-4  px-5">{copy.paragraphs[2]}</p>
        <p className="text-sm md:w-full mt-4  px-5">{copy.paragraphs[3]}</p>
        {/* This image will only be shown on mobile */}
        <div className="md:hidden w-full h-64 flex items-end mt-4">
          <div className="w-full h-full relative">
            <Image
              src={portraitSquare}
              alt={copy.alt}
              fill
              sizes="100vw"
              style={{
                objectFit: "cover",
              }}
            />
          </div>
        </div>
        <p className="text-sm md:w-full mt-4 md:mt-0  p-5">
          {copy.paragraphs[4]}
        </p>
      </div>
      <div className="flex-none hidden md:block w-1/2 h-64 md:h-full flex items-end">
        <div className="w-full h-full relative">
          <Image
            src={portraitSquare}
            alt={copy.alt}
            fill
            sizes="50vw"
            style={{
              objectFit: "cover",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default AboutUs;
