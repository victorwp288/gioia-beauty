"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import logo from "@/images/logo.png";
import { preloadBookingExperience } from "@/components/booking/DeferredBookingExperience";
import LanguageSwitch from "@/components/layout/LanguageSwitch";

const BurgerMenu = ({ menuItems, locale }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const linksRef = useRef(null);
  const toggleRef = useRef(null);
  const copy =
    locale === "en"
      ? {
          close: "Close navigation menu",
          dialog: "Navigation menu",
          open: "Open navigation menu",
        }
      : {
          close: "Chiudi il menu di navigazione",
          dialog: "Menu di navigazione",
          open: "Apri il menu di navigazione",
        };

  useEffect(() => {
    if (isOpen) {
      linksRef.current.classList.add("flex");
      linksRef.current.classList.remove("hidden");
    } else {
      linksRef.current.classList.add("hidden");
      linksRef.current.classList.remove("flex");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const firstLink = linksRef.current?.querySelector("a");
    const toggle = toggleRef.current;
    document.body.style.overflow = "hidden";
    firstLink?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      toggle?.focus();
    };
  }, [isOpen]);

  return (
    <div className={`relative ${isOpen ? "z-40" : ""}`}>
      <button
        ref={toggleRef}
        type="button"
        aria-label={isOpen ? copy.close : copy.open}
        aria-expanded={isOpen}
        aria-controls={menuId}
        className="relative z-40 flex h-11 w-11 flex-col items-center justify-center space-y-1 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span
          className={`block h-0.5 w-5 bg-black motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-in-out ${
            isOpen ? "translate-y-1.5 rotate-45 transform" : ""
          }`}
        ></span>
        <span
          className={`block h-0.5 w-5 bg-black motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-in-out ${
            isOpen ? "opacity-0" : "opacity-100"
          }`}
        ></span>
        <span
          className={`block h-0.5 w-5 bg-black motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-in-out ${
            isOpen ? "-translate-y-1.5 -rotate-45 transform" : ""
          }`}
        ></span>
      </button>
      <div
        id={menuId}
        ref={linksRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.dialog}
        className={`fixed inset-0 hidden flex-col items-start justify-center space-y-4 bg-white px-8 motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-in-out ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        <Image
          src={logo}
          width={64}
          height={26}
          sizes="64px"
          className="absolute left-4 top-4 z-40 w-16"
          alt=""
          style={{
            maxWidth: "100%",
            height: "auto",
          }}
        />

        {menuItems.map((item) => {
          const isShop =
            (item.label && item.label.toString().toLowerCase() === "shop") ||
            (item.link && item.link.includes("payhip.com"));
          const isBooking = item.link?.includes("#booking-section");

          return (
            <Link
              key={item.id}
              href={item.link}
              hrefLang={item.hrefLang}
              lang={item.hrefLang}
              className={`flex min-h-11 items-center rounded-sm font-serif text-3xl font-semibold normal-case focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2 ${
                isShop ? "text-[#76575c]" : "text-black"
              }`}
              onFocus={isBooking ? preloadBookingExperience : undefined}
              onPointerEnter={isBooking ? preloadBookingExperience : undefined}
              onTouchStart={isBooking ? preloadBookingExperience : undefined}
              onClick={() => setIsOpen(false)}
            >
              {item.label}
            </Link>
          );
        })}
        <LanguageSwitch
          locale={locale}
          onClick={() => setIsOpen(false)}
          className="flex min-h-11 items-center rounded-sm font-serif text-3xl font-semibold text-[#76575c] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
        />
      </div>
    </div>
  );
};

export default BurgerMenu;
