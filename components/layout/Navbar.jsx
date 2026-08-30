import Image from "next/image";
import logo from "@/images/logo.png";
import Link from "next/link";
import BurgerMenu from "@/components/BurgerMenu";
import BookingIntentLink from "@/components/layout/BookingIntentLink";
import LanguageSwitch from "@/components/layout/LanguageSwitch";

const labels = {
  it: {
    home: "/",
    services: "I nostri servizi",
    gallery: "Gallery",
    contacts: "Contatti",
    booking: "Prenota",
  },
  en: {
    home: "/en",
    services: "Our services",
    gallery: "Gallery",
    contacts: "Contact",
    booking: "Book",
  },
};

function Navbar({ locale = "it" }) {
  const copy = labels[locale] || labels.it;
  const prefix = locale === "en" ? "/en" : "";
  const menuItems = [
    { id: 1, link: `${prefix}/#services`, label: copy.services },
    { id: 2, link: `${prefix}/gallery`, label: copy.gallery },
    { id: 3, link: `${prefix}/contacts`, label: copy.contacts },
    { id: 4, link: `${prefix}/#booking-section`, label: copy.booking },
    { id: 5, link: "https://payhip.com/GioiaBeauty", label: "Shop ♡" },
  ];
  const navigationLabel =
    locale === "en" ? "Primary navigation" : "Navigazione principale";

  return (
    <header className="fixed top-0 z-40 flex w-full items-center justify-between bg-white px-4 py-4 text-sm motion-safe:transition motion-safe:duration-300 motion-safe:ease-in-out md:px-28 lg:px-64">
      <Link
        href={copy.home}
        aria-label={
          locale === "en" ? "Gioia Beauty home" : "Gioia Beauty, home"
        }
        className="flex min-h-11 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
      >
        <Image
          src={logo}
          width={80}
          height={33}
          sizes="(min-width: 1024px) 80px, 64px"
          className="w-16 lg:w-20"
          alt="Gioia Beauty"
          style={{
            maxWidth: "100%",
            height: "auto",
          }}
        />
      </Link>
      <nav aria-label={navigationLabel} className="hidden md:block">
        <ul className="flex items-center gap-8 lg:gap-10">
          <li>
            <Link
              href={`${prefix}/#services`}
              className="link flex min-h-11 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            >
              {copy.services.toUpperCase()}
            </Link>
          </li>
          <li>
            <Link
              href={`${prefix}/gallery`}
              className="link flex min-h-11 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            >
              GALLERY
            </Link>
          </li>
          <li>
            <Link
              href={`${prefix}/contacts`}
              className="link flex min-h-11 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            >
              {copy.contacts.toUpperCase()}
            </Link>
          </li>
          <li>
            <BookingIntentLink
              href={`${prefix}/#booking-section`}
              className="link flex min-h-11 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            >
              {copy.booking.toUpperCase()}
            </BookingIntentLink>
          </li>
          <li>
            <Link
              href="https://payhip.com/GioiaBeauty"
              className="link flex min-h-11 items-center rounded-sm bg-[#76575c] px-6 py-3 font-semibold text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              SHOP
            </Link>
          </li>
          <li className="flex items-center">
            <LanguageSwitch
              locale={locale}
              className="flex min-h-11 items-center rounded-full border border-[#76575c] px-3 py-1.5 font-semibold text-[#76575c] motion-safe:transition hover:bg-[#f8eff0] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            />
          </li>
        </ul>
      </nav>
      <div className="md:hidden">
        <BurgerMenu menuItems={menuItems} locale={locale} />
      </div>
    </header>
  );
}

export default Navbar;
