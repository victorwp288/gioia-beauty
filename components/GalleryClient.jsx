"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { FaArrowLeft, FaArrowRight, FaTimes } from "react-icons/fa";
import Modal from "react-modal";

const GalleryClient = ({ images }) => {
  const [activeCategory, setActiveCategory] = useState("Tutti");
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const categories = useMemo(
    () => ["Tutti", ...new Set(images.map((image) => image.category))],
    [images],
  );

  const filteredImages = useMemo(() => {
    if (activeCategory === "Tutti") {
      return images;
    }

    return images.filter((image) => image.category === activeCategory);
  }, [activeCategory, images]);

  useEffect(() => {
    Modal.setAppElement("body");
  }, []);

  useEffect(() => {
    if (!modalIsOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "ArrowLeft") {
        setCurrentIndex(
          (prevIndex) =>
            (prevIndex - 1 + filteredImages.length) % filteredImages.length,
        );
      }

      if (event.key === "ArrowRight") {
        setCurrentIndex((prevIndex) => (prevIndex + 1) % filteredImages.length);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [filteredImages.length, modalIsOpen]);

  useEffect(() => {
    if (modalIsOpen && currentIndex > filteredImages.length - 1) {
      setCurrentIndex(0);
    }
  }, [currentIndex, filteredImages.length, modalIsOpen]);

  const openModal = (index) => {
    setCurrentIndex(index);
    setModalIsOpen(true);
  };

  const closeModal = () => {
    setModalIsOpen(false);
  };

  const goToPrevious = () => {
    setCurrentIndex(
      (prevIndex) =>
        (prevIndex - 1 + filteredImages.length) % filteredImages.length,
    );
  };

  const goToNext = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % filteredImages.length);
  };

  const currentImage = filteredImages[currentIndex];

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
            {category}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredImages.map((image, index) => (
          <button
            key={`${image.title}-${index}`}
            type="button"
            onClick={() => openModal(index)}
            className="group relative overflow-hidden rounded-2xl border border-white/80 bg-white/80 text-left shadow-[0_20px_45px_-32px_rgba(31,23,20,0.65)] backdrop-blur-sm animate-fade-up"
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <Image
              src={image.src}
              width={700}
              height={900}
              alt={`${image.title} - Gioia Beauty`}
              className="h-72 w-full object-cover transition duration-700 ease-out group-hover:scale-[1.04] md:h-80"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent opacity-90 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
              <p className="text-lg font-semibold">{image.title}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/85">
                {image.category}
              </p>
            </div>
          </button>
        ))}
      </div>

      {filteredImages.length === 0 && (
        <div className="rounded-2xl border border-[#e5d7d8] bg-white/80 px-6 py-8 text-center text-[#6f6663]">
          Nessuna immagine disponibile per questa categoria.
        </div>
      )}

      <Modal
        isOpen={modalIsOpen}
        onRequestClose={closeModal}
        contentLabel="Galleria immagini"
        shouldCloseOnEsc
        shouldCloseOnOverlayClick
        className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
        overlayClassName="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-sm animate-lightbox-overlay"
      >
        {currentImage && (
          <div className="animate-lightbox-in relative w-full max-w-5xl max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-3xl border border-white/20 bg-[#1c1a19]/90 p-4 text-white shadow-2xl md:max-h-[calc(100vh-3rem)] md:p-6">
            <button
              type="button"
              aria-label="Chiudi galleria"
              onClick={closeModal}
              className="absolute right-3 top-3 rounded-full border border-white/25 bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
            >
              <FaTimes />
            </button>

            <button
              type="button"
              aria-label="Immagine precedente"
              onClick={goToPrevious}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
            >
              <FaArrowLeft />
            </button>

            <button
              type="button"
              aria-label="Immagine successiva"
              onClick={goToNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
            >
              <FaArrowRight />
            </button>

            <div className="overflow-hidden rounded-2xl bg-black/25">
              <Image
                src={currentImage.src}
                width={1600}
                height={1100}
                alt={`${currentImage.title} - Gioia Beauty`}
                className="max-h-[50vh] w-full object-contain md:max-h-[56vh]"
                priority
              />
            </div>

            <div className="mt-4 flex flex-col gap-2 text-center md:flex-row md:items-end md:justify-between md:text-left">
              <div>
                <p className="text-2xl font-semibold">{currentImage.title}</p>
                <p className="mt-1 text-sm uppercase tracking-[0.2em] text-white/75">
                  {currentImage.category}
                </p>
              </div>
              <p className="text-sm text-white/70">
                {currentIndex + 1} / {filteredImages.length}
              </p>
            </div>

            <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1">
              {filteredImages.map((image, index) => (
                <button
                  key={`${image.title}-thumb-${index}`}
                  type="button"
                  onClick={() => setCurrentIndex(index)}
                  className={`h-14 min-w-14 overflow-hidden rounded-lg border transition ${
                    currentIndex === index
                      ? "border-white"
                      : "border-white/20 opacity-80 hover:opacity-100"
                  }`}
                >
                  <Image
                    src={image.src}
                    width={200}
                    height={140}
                    alt={`${image.title} miniatura`}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};

export default GalleryClient;
