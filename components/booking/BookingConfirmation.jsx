"use client";
import React, { useEffect } from "react";
import Modal from "react-modal";

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

const BookingConfirmation = ({ isOpen, onRequestClose }) => {
  const handleClose = () => {
    onRequestClose();
    window.location.reload();
  };

  // Set the app element when component mounts to avoid SSR issues
  useEffect(() => {
    // Try to find the Next.js app element, fallback to body
    const appElement =
      document.querySelector("#__next") ||
      document.querySelector("[data-nextjs-root]") ||
      document.body;

    if (appElement) {
      Modal.setAppElement(appElement);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      // If the modal is open, set a timeout to refresh the page after 10 seconds
      const timeoutId = setTimeout(() => {
        window.location.reload();
      }, 10000);

      // Return a cleanup function to clear the timeout if the modal is closed before the 10 seconds are up
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      // If the modal is open, set a timeout to refresh the page after 10 seconds
      const timeoutId = setTimeout(() => {
        window.location.reload();
      }, 10000);

      // Return a cleanup function to clear the timeout if the modal is closed before the 10 seconds are up
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);
  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={handleClose}
      style={customStyles}
      contentLabel="Appointment Booked"
      ariaHideApp={false}
    >
      <h2 className="font-serif md:text-2xl text-primary font-semibold">
        L&apos;appuntamento è stato prenotato
      </h2>

      <button className="absolute top-4 right-4" onClick={handleClose}>
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
