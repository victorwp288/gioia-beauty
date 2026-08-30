"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { whiteTick } from "./ImagesExports";
import rightArrow from "@/images/chevron-right.svg";
import leftArrow from "@/images/chevron-left.svg";

const technologiesByLocale = {
  it: [
    [
      "Laser",
      "Il laser Eraser usa una matrice tridimensionale e tre lunghezze d’onda per un trattamento potente, sicuro e senza dolore.",
    ],
    [
      "LPG",
      "Cellu M6 Alliance stimola naturalmente collagene, elastina e acido ialuronico, aiuta a levigare la cellulite e a rimodellare la figura.",
    ],
    [
      "Elettroporatore",
      "Piccoli impulsi rendono temporaneamente la pelle più permeabile e favoriscono l’assorbimento dei cosmetici per trattamenti viso e corpo.",
    ],
    [
      "Ossigeno dermo infusione",
      "Ossigeno puro e acido ialuronico migliorano idratazione, luminosità e compattezza della pelle.",
    ],
    [
      "Pressoterapia",
      "Compressioni e decompressioni graduali favoriscono il drenaggio, il ritorno venoso e una piacevole sensazione di leggerezza.",
    ],
  ],
  en: [
    [
      "Laser",
      "Eraser combines a three-dimensional matrix with three wavelengths for a powerful, safe and comfortable treatment.",
    ],
    [
      "LPG",
      "Cellu M6 Alliance naturally stimulates collagen, elastin and hyaluronic acid while helping smooth cellulite and reshape the silhouette.",
    ],
    [
      "Electroporation",
      "Gentle electrical pulses temporarily increase skin permeability, helping selected cosmetics reach the areas targeted by face and body treatments.",
    ],
    [
      "Oxygen dermal infusion",
      "Pure oxygen and hyaluronic acid help improve hydration, radiance and the appearance of firmer skin.",
    ],
    [
      "Pressotherapy",
      "Gradual compression and release supports drainage and circulation, leaving the legs feeling lighter.",
    ],
  ],
};

function Technologies({ locale = "it" }) {
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

  const technologies = technologiesByLocale[locale].map(
    ([title, description]) => ({
      title,
      description,
    }),
  );

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
  const effectivePct = Math.max(
    0,
    Math.min(translatePct - dragPct, targetMaxPct),
  );

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
        <p className="text-xs font-extrabold text-white">
          {locale === "en" ? "DISCOVER" : "SCOPRI"}
        </p>
        <h2 className="font-serif text-3xl font-bold tracking-tight text-white md:text-3xl">
          {locale === "en" ? "Our technology" : "Le tecnologie"}
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
            className={`flex ${dragStartX === null ? "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out" : "will-change-transform"}`}
            style={{ transform: `translateX(-${effectivePct}%)` }}
          >
            {technologies.map((tech, index) => (
              <div
                key={index}
                className="shrink-0 basis-full md:basis-1/3"
              >
                <div className="text-white flex flex-col gap-2 px-6 py-4 md:px-7">
                  <Image
                    src={whiteTick}
                    width={26}
                    height={26}
                    alt=""
                    style={{
                      maxWidth: "100%",
                      height: "auto",
                    }}
                  />
                  <h3 className="text-lg font-semibold">{tech.title}</h3>
                  <p className="text-sm w-[90%]">{tech.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {currentIndex > 0 && (
          <button
            type="button"
            onClick={prev}
            aria-label={
              locale === "en" ? "Previous technology" : "Tecnologia precedente"
            }
            className="absolute left-0 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#62747e] md:-left-12"
          >
            <Image
              alt=""
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
            type="button"
            onClick={next}
            aria-label={
              locale === "en" ? "Next technology" : "Tecnologia successiva"
            }
            className="absolute right-0 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#62747e] md:-right-12"
          >
            <Image
              alt=""
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
