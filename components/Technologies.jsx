"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { whiteTick } from "./ImagesExports";
import rightArrow from "@/images/chevron-right.svg";
import leftArrow from "@/images/chevron-left.svg";

function Technologies() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [windowWidth, setWindowWidth] = useState(0);
  const viewportRef = useRef(null);
  const [dragStartX, setDragStartX] = useState(null);
  const [dragDelta, setDragDelta] = useState(0);

  const isDesktop = windowWidth >= 768;
  const itemsPerView = isDesktop ? 3 : 1;

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const technologies = [
    {
      title: "Laser",
      description:
        "Il laser eraser presente in istituto è la prima tecnologia laser a matrice tridimensionale che ottimizza la tripla lunghezza d’onda assicurando un trattamento unico e performante. Massima potenza, totale sicurezza e zero dolore.",
    },
    {
      title: "LPG",
      description:
        "Cellu m6 Alliance effettua un massaggio meccanico sulla superficie della pelle per stimolare in modo naturale e sicuro le cellule. Stimola la produzione di collagene, elastina e acido ialuronico, la pelle risulta più giovane, compatta e luminosa. Attiva la lipolisi per levigare la cellulite, rimodellare e snellire la figura.",
    },
    {
      title: "Elettroporatore",
      description:
        "L’elettroporatore è un macchinario perfetto per trattare gli inestetismi di viso e corpo. Tramite piccoli impulsi elettrici rende le cellule più permeabili, facendo penetrare i cosmetici applicati in profondità. Perfetto per contrastare l'invecchiamento cutaneo, per pelli con rughe e macchie, per inestetismi come la perdita di tono e la cellulite.",
    },
    {
      title: "Ossigeno dermo infusione",
      description:
        "L’ossigeno dermo infusione è una tecnologia estetica che, tramite ossigeno puro in combinazione con acido iarulonico, migliora l'idratazione, rende la pelle liftata, contrasta le rughe, drena e ossigena i tessuti. Dona alla pelle un immediato effetto di compattezza, rendendola fin da subito più liscia e luminosa.",
    },
    {
      title: "Pressoterapia",
      description:
        "Attraverso compressioni e decompressioni graduali di specifici gambali, la pressoterapia simula un massaggio drenante manuale. Favorisce le naturali funzioni del corpo, il ritorno venoso e l'eliminazione di sostanze di scarto dell'organismo. È particolarmente indicata per chi soffre di ritenzione idrica, cellulite, gambe gonfie e adiposità.",
    },
  ];

  const maxIndex = useMemo(() => {
    return Math.max(technologies.length - itemsPerView, 0);
  }, [technologies.length, itemsPerView]);

  // Clamp index when viewport changes between mobile/desktop
  useEffect(() => {
    setCurrentIndex((prev) => Math.min(prev, maxIndex));
  }, [maxIndex]);

  const goTo = (idx) => {
    setCurrentIndex((prev) => Math.max(0, Math.min(idx, maxIndex)));
  };

  const next = () => goTo(currentIndex + 1);
  const prev = () => goTo(currentIndex - 1);

  // Translate by one item width each step (100% / itemsPerView)
  const translatePct = (100 / itemsPerView) * currentIndex;
  const containerWidth = viewportRef.current?.offsetWidth || 1;
  const dragPct = dragStartX !== null ? (dragDelta / containerWidth) * 100 : 0;
  const targetMaxPct = (100 / itemsPerView) * maxIndex;
  const effectivePct = Math.max(0, Math.min(translatePct - dragPct, targetMaxPct));

  const onTouchStart = (e) => {
    if (e.touches && e.touches.length > 0) {
      setDragStartX(e.touches[0].clientX);
      setDragDelta(0);
    }
  };

  const onTouchMove = (e) => {
    if (dragStartX !== null && e.touches && e.touches.length > 0) {
      const currentX = e.touches[0].clientX;
      setDragDelta(currentX - dragStartX);
    }
  };

  const endDrag = () => {
    if (dragStartX === null) return;
    const width = viewportRef.current?.offsetWidth || 1;
    const itemWidth = width / itemsPerView;
    const threshold = itemWidth * 0.2;
    const delta = dragDelta;

    if (delta <= -threshold) {
      setCurrentIndex((prev) => Math.min(prev + 1, maxIndex));
    } else if (delta >= threshold) {
      setCurrentIndex((prev) => Math.max(prev - 1, 0));
    }

    setDragStartX(null);
    setDragDelta(0);
  };

  return (
    <div className="m-auto md:w-[70vw] md:py-12 py-6">
      <div className="m-auto w-[90vw] md:w-[70vw] flex flex-col gap-2 py-4 pb-6 md:gap-4 md:py-4">
        <h4 className=" text-xs font-extrabold text-white ">SCOPRI</h4>
        <h2 className="font-serif text-3xl font-bold tracking-tight text-white md:text-3xl">
          Le tecnologie
        </h2>
      </div>
      <div className="relative">
        <div
          ref={viewportRef}
          className="overflow-hidden touch-pan-y"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={endDrag}
          onTouchCancel={endDrag}
        >
          <div
            className={`flex will-change-transform ${dragStartX === null ? "transition-transform duration-300 ease-out" : ""}`}
            style={{ transform: `translateX(-${effectivePct}%)` }}
          >
            {technologies.map((tech, index) => (
              <div
                key={index}
                className="flex-shrink-0 basis-full md:basis-1/3"
              >
                <div className="text-white flex flex-col gap-2 px-6 py-4 md:px-7">
                  <Image
                    src={whiteTick}
                    width={26}
                    height={26}
                    alt="technology indicator"
                    style={{
                      maxWidth: "100%",
                      height: "auto",
                    }}
                  />
                  <h2 className="text-lg font-semibold">{tech.title}</h2>
                  <p className="text-sm w-[90%]">{tech.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {currentIndex > 0 && (
          <button
            onClick={prev}
            aria-label="Previous"
            className="absolute left-2 md:-left-10 top-1/2 -translate-y-1/2 text-white rounded-full"
          >
            <Image
              alt="left arrow"
              src={leftArrow}
              style={{
                maxWidth: "100%",
                height: "auto",
              }}
            />
          </button>
        )}
        {currentIndex < maxIndex && (
          <button
            onClick={next}
            aria-label="Next"
            className="absolute right-2 md:-right-10 top-1/2 -translate-y-1/2 text-white rounded-full"
          >
            <Image
              alt="right arrow"
              src={rightArrow}
              style={{
                maxWidth: "100%",
                height: "auto",
              }}
            />
          </button>
        )}
      </div>
    </div>
  );
}

export default Technologies;
