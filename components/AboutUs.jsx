import React from "react";
import Image from "next/image";
import { portraitSquare } from "./ImagesExports";

function AboutUs() {
  return (
    <div className="flex flex-col md:flex-row md:w-[100vw] h-auto md:h-screen">
      <div className="flex-1 flex-shrink-0 md:p-[5%] md:py-8 py-10 overflow-auto">
        <div className="flex flex-col gap-2 py-2 pb-6 md:gap-4 md:py-4  px-5">
          <h4 className="text-xs font-extrabold text-primary">SCOPRI</h4>
          <h2 className="font-serif text-3xl font-bold tracking-tight md:text-3xl">
            Come nasce Gioia Beauty
          </h2>
        </div>
        <p className="text-sm md:w-full  px-5">
          Ciao! Sono Gioia, nata nel 2003 e da sempre appassionata del mondo
          dell’estetica.
        </p>
        <p className="text-sm md:w-full mt-4  px-5">
          Questa mia passione mi ha accompagnato fin da bambina, portandomi nel
          2019 a iscrivermi all’Enaip di Piacenza, dove ho frequentato il
          biennio di estetica.
        </p>
        <p className="text-sm md:w-full mt-4  px-5">
          A 18 anni, completato il biennio, ho deciso di continuare la mia
          formazione presso la Diadema Academy, l’accademia italiana di
          eccellenza nel settore dell’estetica. Ho frequentato il secondo e il
          terzo anno, arricchendo contemporaneamente la mia esperienza
          lavorativa prima in un centro a Milano e successivamente in un centro
          estetico nella provincia di Parma.
        </p>
        <p className="text-sm md:w-full mt-4  px-5">
          Dopo due anni di studi, mi sono diplomata con una specializzazione e
          il massimo dei voti. Ho proseguito la mia formazione ottenendo
          l’attestato da make-up artist e hairstylist presso l’Accademia MUD di
          Milano, scuola fondata nel 1997 a Los Angeles e arrivata a Milano nel
          2016.
        </p>
        {/* This image will only be shown on mobile */}
        <div className="md:hidden w-full h-64 flex items-end mt-4">
          <div className="w-full h-full relative">
            <Image
              src={portraitSquare}
              alt="Portrait of Gioia"
              fill
              sizes="100vw"
              style={{
                objectFit: "cover"
              }} />
          </div>
        </div>
        <p className="text-sm md:w-full mt-4 md:mt-0  p-5">
          Grazie alla mia esperienza e alla continua formazione, ho creato un
          ambiente accogliente con servizi di alta qualità, unendo l’impegno per
          la sostenibilità attraverso l’uso di prodotti biologici, vegani e
          strumenti riutilizzabili e riciclabili.
        </p>
      </div>
      <div className="flex-none hidden md:block w-1/2 h-64 md:h-full flex items-end">
        <div className="w-full h-full relative">
          <Image
            src={portraitSquare}
            alt="Portrait of Gioia"
            fill
            sizes="100vw"
            style={{
              objectFit: "cover"
            }} />
        </div>
      </div>
    </div>
  );
}

export default AboutUs;
