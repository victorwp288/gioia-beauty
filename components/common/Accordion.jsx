"use client";

import React, { useState } from "react";
import Image from "next/image";

const Accordion = ({ title, description, image, children, imagePosition }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleAccordion = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="h-auto w-full overflow-hidden border-[0.5px] border-solid border-[#e2ecf9] bg-white shadow-[0px_2px_5px_#e2ecf9da]">
      <div
        className={`flex cursor-pointer flex-col items-center md:flex-row ${
          imagePosition === "right" ? "md:flex-row-reverse" : ""
        }`}
        onClick={toggleAccordion}
      >
        <div className="relative w-full md:basis-[50%]">
          <div className="relative  w-full pb-[56.25%] md:pb-0 md:h-60">
            <Image
              src={image}
              fill
              style={{ objectFit: "cover" }}
              alt="mani-piedi"
            />
          </div>
        </div>
        <div className="flex flex-col items-start gap-4 p-6 py-6 text-left md:basis-[50%] md:px-0 md:py-8 md:pl-9">
          <h2 className="font-serif text-2xl font-bold">{title}</h2>
          <p className="w-full text-sm md:w-[85%]">{description}</p>
          <button
            type="button"
            className="border-0 bg-white text-xs font-bold text-primary no-underline"
          >
            {isOpen ? "Chiudi ⋀" : "Scopri di più →"}
          </button>
        </div>
      </div>
      <div
        className={`overflow-hidden transition duration-300 ease-in-out ${
          isOpen ? "h-auto" : "h-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
};

export default Accordion;
