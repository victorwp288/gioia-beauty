"use client";
import React, { useEffect } from "react";
import Modal from "react-modal";

import { bookingContent } from "@/lib/content/bookingContent";

const customStyles = {
  content: {
    display: "flex",
    top: "50%",
    left: "50%",
    right: "auto",
    bottom: "auto",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    border: "1px solid #e2ecf9",
    paddingLeft: "2rem",
    paddingRight: "2rem",
    paddingTop: "4rem",
    paddingBottom: "4rem",
  },
};

const BookingConfirmation = ({ isOpen, locale = "it", onRequestClose }) => {
  const copy = bookingContent(locale);
  useEffect(() => {
    const appElement = document.querySelector("main");
    if (appElement) Modal.setAppElement(appElement);
  }, []);
  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onRequestClose}
      style={customStyles}
      contentLabel={copy.confirmation}
    >
      <h2 className="font-serif md:text-2xl text-primary font-semibold">
        {copy.confirmation}
      </h2>

      <button
        type="button"
        aria-label={copy.closeConfirmation}
        className="absolute top-4 right-4"
        onClick={onRequestClose}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          fill="currentColor"
          className="bi bi-x-circle-fill "
          viewBox="0 0 16 16"
        >
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z" />
        </svg>
      </button>
    </Modal>
  );
};

export default BookingConfirmation;
