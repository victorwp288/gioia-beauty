import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
const logo = "/images/logo.webp";

const BurgerMenu = ({ isOpen, setIsOpen, menuItems }) => {
  const linksRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      linksRef.current.classList.add("flex");
      linksRef.current.classList.remove("hidden");
    } else {
      linksRef.current.classList.add("hidden");
      linksRef.current.classList.remove("flex");
    }
  }, [isOpen]);

  return (
    <div className={`relative ${isOpen ? "z-40" : ""}`}>
      <button
        className="relative z-40 flex h-8 w-8 flex-col items-center justify-center space-y-1"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={isOpen}
      >
        <span
          className={`block h-0.5 w-5 bg-black transition-transform duration-300 ease-in-out ${
            isOpen ? "translate-y-1.5 rotate-45 transform" : ""
          }`}
        ></span>
        <span
          className={`block h-0.5 w-5 bg-black transition-opacity duration-300 ease-in-out ${
            isOpen ? "opacity-0" : "opacity-100"
          }`}
        ></span>
        <span
          className={`block h-0.5 w-5 bg-black transition-transform duration-300 ease-in-out ${
            isOpen ? "-translate-y-1.5 -rotate-45 transform" : ""
          }`}
        ></span>
      </button>
      <div
        ref={linksRef}
        className={` fixed inset-0 hidden flex-col items-start justify-center space-y-4 bg-white px-8 transition-opacity duration-300 ease-in-out ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        <Image
          src={logo}
          width={80}
          height={80}
          className=" absolute left-4 top-4 z-40 w-16 lg:w-20"
          alt="Logo"
          style={{
            maxWidth: "100%",
            height: "auto"
          }} />

        {menuItems.map((item) => (
          <Link key={item.id} href={item.link} passHref>
            <p
              className="cursor-pointer  font-serif text-3xl font-semibold normal-case"
              onClick={() => setIsOpen(false)}
            >
              {item.label}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default BurgerMenu;
