"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

const GalleryLightbox = dynamic(() => import("@/components/GalleryLightbox"), {
  ssr: false,
});

const categoryLabels = {
  en: {
    Tutti: "All",
    Spazi: "Salon",
    Tecnologie: "Technology",
    Trattamenti: "Treatments",
  },
};

function DeferredGalleryImage({ image, index }) {
  const shouldPrioritize = index === 0;
  const [shouldLoad, setShouldLoad] = useState(shouldPrioritize);
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || shouldLoad) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      const fallbackTimer = window.setTimeout(() => setShouldLoad(true), 0);
      return () => window.clearTimeout(fallbackTimer);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <div
      ref={containerRef}
      className="relative h-72 w-full bg-[#e8dfdc] md:h-80"
    >
      {shouldLoad ? (
        <Image
          src={image.src}
          fill
          alt={`${image.title} - Gioia Beauty`}
          fetchPriority={shouldPrioritize ? "high" : "low"}
          loading={shouldPrioritize ? "eager" : "lazy"}
          sizes="(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 30vw"
          className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
        />
      ) : null}
    </div>
  );
}

export default function GalleryClient({ images, locale = "it" }) {
  "use memo";

  const [activeCategory, setActiveCategory] = useState("Tutti");
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const categories = useMemo(
    () => ["Tutti", ...new Set(images.map((image) => image.category))],
    [images],
  );
  const filteredImages = useMemo(
    () =>
      (activeCategory === "Tutti"
        ? images
        : images.filter((image) => image.category === activeCategory)
      ).map((image) => ({
        ...image,
        categoryLabel:
          categoryLabels[locale]?.[image.category] || image.category,
      })),
    [activeCategory, images, locale],
  );

  const openModal = (index) => {
    setCurrentIndex(index);
    setModalIsOpen(true);
  };

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center justify-center gap-3">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`rounded-full border px-5 py-2 text-sm font-medium transition-all duration-300 ${
              activeCategory === category
                ? "border-[#b38f93] bg-[#b38f93] text-white shadow-md"
                : "border-[#d9c6c8] bg-white/80 text-[#6f6663] hover:border-[#b38f93] hover:text-[#4e4542]"
            }`}
          >
            {categoryLabels[locale]?.[category] || category}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredImages.map((image, index) => (
          <button
            key={`${image.title}-${index}`}
            type="button"
            onClick={() => openModal(index)}
            className="group relative overflow-hidden rounded-2xl border border-white/80 bg-white/80 text-left shadow-[0_20px_45px_-32px_rgba(31,23,20,0.65)] backdrop-blur-xs animate-fade-up"
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <DeferredGalleryImage image={image} index={index} />
            <div className="absolute inset-0 bg-linear-to-t from-black/60 via-black/15 to-transparent opacity-90 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
              <p className="text-lg font-semibold">{image.title}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/85">
                {image.categoryLabel}
              </p>
            </div>
          </button>
        ))}
      </div>

      {modalIsOpen ? (
        <GalleryLightbox
          images={filteredImages}
          currentIndex={currentIndex}
          setCurrentIndex={setCurrentIndex}
          onClose={() => setModalIsOpen(false)}
          locale={locale}
        />
      ) : null}
    </section>
  );
}
