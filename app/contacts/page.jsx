// pages/contacts.js

import React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

export const metadata = {
  title: "Contatti - Centro Estetico Gioia Beauty Roveleto di Cadeo",
  description:
    "Contatta Gioia Beauty per prenotare i tuoi trattamenti estetici. Siamo a Roveleto di Cadeo, Via Emilia 60. Tel: +39 391 421 3634. Email: gioiabeautyy@gmail.com",
  keywords:
    "contatti gioia beauty, centro estetico roveleto cadeo, prenota trattamento estetico piacenza, via emilia 60",
  openGraph: {
    title: "Contatti - Centro Estetico Gioia Beauty",
    description:
      "Contatta Gioia Beauty per prenotare i tuoi trattamenti estetici. Via Emilia 60, Roveleto di Cadeo.",
    images: [
      {
        url: "https://www.gioiabeauty.net/ogimage.png",
        width: 1200,
        height: 630,
        alt: "Contatti centro estetico Gioia Beauty",
      },
    ],
  },
};

const Contacts = () => {
  const Map = dynamic(() => import("@/components/common/Map"), {
    ssr: false,
  });

  const latitude = 44.96556;
  const longitude = 9.8514;
  return (
    <div className="animate-fadeIn m-auto mt-24 w-[90vw] md:mt-32 md:w-[70vw]">
      <h2 className="font-serif text-3xl font-bold tracking-tight md:text-3xl">
        I nostri contatti
      </h2>
      <div className="grid md:grid-cols-2 pt-8 md:gap-0 gap-8">
        <div className="flex flex-col gap-2 md:gap-4">
          <h2 className=" text-xl font-bold tracking-tight md:text-xl">
            Orari di apertura
          </h2>
          <div>
            <p>
              Lunedì, Mercoledi <b>9.00 - 19.00</b>
            </p>
            <p>
              Martedì, Giovedì <b>10.00 - 20.00</b>
            </p>
            <p>
              Venerdì <b>9.00 - 18.30</b>
            </p>
            <p>
              Sabato, Domenica <b>Chiuso</b>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:gap-4">
          <h2 className=" text-xl font-bold tracking-tight md:text-xl">
            Contatti
          </h2>
          <div>
            <Link
              target="_blank"
              href={"https://maps.app.goo.gl/Vg7QqpUBStAnfnzV7"}
            >
              <p>Via Emilia 60, 29010 Roveleto PC</p>
            </Link>
            <Link className="underline" href="mailto:gioiabeautyy@gmail.com">
              <p>gioiabeautyy@gmail.com</p>
            </Link>
            <Link href="tel:+393914213634">
              <p>+39 391 421 3634</p>
            </Link>
            <Link
              target="_blank"
              href="https://www.instagram.com/gioiabeautyy/"
            >
              <p>@gioiabeautyy</p>
            </Link>
          </div>
        </div>
      </div>

      <div>
        <Map latitude={latitude} longitude={longitude} />
      </div>
    </div>
  );
};

export default Contacts;
