"use client";

import React, { useState } from "react";
import Image from "next/image";
import Modal from "react-modal";
import { FaArrowLeft, FaArrowRight, FaTimes } from "react-icons/fa";

const GalleryClient = ({ imagesWithDescriptions, index }) => {
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(index);

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
        (prevIndex - 1 + imagesWithDescriptions.length) %
        imagesWithDescriptions.length
    );
  };

  const goToNext = () => {
    setCurrentIndex(
      (prevIndex) => (prevIndex + 1) % imagesWithDescriptions.length
    );
  };

  return (
    <>
      <Image
        src={imagesWithDescriptions[index].src}
        width={300}
        height={300}
        alt={`Image ${index}`}
        className="object-cover h-full w-full cursor-pointer"
        onClick={() => openModal(index)}
        style={{
          maxWidth: "100%",
          height: "auto"
        }} />
      <Modal
        isOpen={modalIsOpen}
        onRequestClose={closeModal}
        contentLabel="Image Modal"
        className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-75"
        overlayClassName="fixed inset-0 bg-black bg-opacity-75"
      >
        <button
          className="z-20 absolute md:top-20 top-20 right-0 m-2 p-2 bg-white rounded-full"
          onClick={closeModal}
          aria-label="Close image gallery"
        >
          <FaTimes />
        </button>
        <button
          className="z-20 absolute top-1/2 left-4 transform -translate-y-1/2 p-2 bg-white rounded-full"
          onClick={goToPrevious}
          aria-label="Previous image"
        >
          <FaArrowLeft />
        </button>
        <button
          className="z-20 absolute top-1/2 right-4 transform -translate-y-1/2 p-2 bg-white rounded-full"
          onClick={goToNext}
          aria-label="Next image"
        >
          <FaArrowRight />
        </button>
        <div className="relative max-w-3xl mx-auto">
          <div className="flex justify-center items-center">
            <Image
              src={imagesWithDescriptions[currentIndex].src}
              width={800}
              height={800}
              alt={`Image ${currentIndex}`}
              className="max-h-screen h-auto w-auto"
              style={{
                maxWidth: "100%",
                height: "auto"
              }} />
          </div>
          <p className="text-white text-xl font-semibold z-100 bottom-2 left-4 absolute">
            {imagesWithDescriptions[currentIndex].description}
          </p>
        </div>
      </Modal>
    </>
  );
};

export default GalleryClient;
