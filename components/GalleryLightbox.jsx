"use client";

import Image from "next/image";
import { useEffect } from "react";
import { FaArrowLeft, FaArrowRight, FaTimes } from "react-icons/fa";
import Modal from "react-modal";

export default function GalleryLightbox({
  images,
  currentIndex,
  setCurrentIndex,
  onClose,
  locale = "it",
}) {
  useEffect(() => {
    Modal.setAppElement("body");
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "ArrowLeft") {
        setCurrentIndex((index) => (index - 1 + images.length) % images.length);
      }
      if (event.key === "ArrowRight") {
        setCurrentIndex((index) => (index + 1) % images.length);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [images.length, setCurrentIndex]);

  const image = images[currentIndex];
  if (!image) return null;

  const previous = () =>
    setCurrentIndex((index) => (index - 1 + images.length) % images.length);
  const next = () => setCurrentIndex((index) => (index + 1) % images.length);

  return (
    <Modal
      isOpen
      onRequestClose={onClose}
      contentLabel={locale === "en" ? "Image gallery" : "Galleria immagini"}
      shouldCloseOnEsc
      shouldCloseOnOverlayClick
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
      overlayClassName="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs animate-lightbox-overlay"
    >
      <div className="animate-lightbox-in relative max-h-[calc(100vh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-3xl border border-white/20 bg-[#1c1a19]/90 p-4 text-white shadow-2xl md:max-h-[calc(100vh-3rem)] md:p-6">
        <button
          type="button"
          aria-label={locale === "en" ? "Close gallery" : "Chiudi galleria"}
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full border border-white/25 bg-white/10 p-3 transition-colors hover:bg-white/20"
        >
          <FaTimes />
        </button>
        <button
          type="button"
          aria-label={
            locale === "en" ? "Previous image" : "Immagine precedente"
          }
          onClick={previous}
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-white/10 p-3 transition-colors hover:bg-white/20"
        >
          <FaArrowLeft />
        </button>
        <button
          type="button"
          aria-label={locale === "en" ? "Next image" : "Immagine successiva"}
          onClick={next}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-white/10 p-3 transition-colors hover:bg-white/20"
        >
          <FaArrowRight />
        </button>
        <div className="overflow-hidden rounded-2xl bg-black/25">
          <Image
            src={image.src}
            width={1600}
            height={1100}
            alt={`${image.title} - Gioia Beauty`}
            sizes="(max-width: 768px) 94vw, 1024px"
            className="max-h-[56vh] w-full object-contain"
          />
        </div>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold">{image.title}</p>
            <p className="mt-1 text-sm uppercase tracking-[0.2em] text-white/75">
              {image.categoryLabel || image.category}
            </p>
          </div>
          <p className="text-sm text-white/70">
            {currentIndex + 1} / {images.length}
          </p>
        </div>
        <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1">
          {images.map((item, index) => (
            <button
              key={`${item.title}-thumb-${index}`}
              type="button"
              aria-label={`${locale === "en" ? "Show" : "Mostra"} ${item.title}`}
              onClick={() => setCurrentIndex(index)}
              className={`h-14 min-w-14 overflow-hidden rounded-lg border ${currentIndex === index ? "border-white" : "border-white/20 opacity-80 hover:opacity-100"}`}
            >
              <Image
                src={item.src}
                width={112}
                height={112}
                alt=""
                sizes="56px"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
