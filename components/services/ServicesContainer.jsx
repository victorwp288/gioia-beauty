"use client";
import React, { useState, useRef, useEffect } from "react";
import Accordion from "@/components/common/Accordion";
import Image from "next/image";
import {
  maniPiedi,
  rituale,
  ciglia,
  tick,
  cerettaPic,
  makeupPic,
  massaggiPic,
  clock,
  bagnoTurcoPic,
  viso,
} from "@/components/ImagesExports";
import manicure from "@/data/manicureData";
import pedicure from "@/data/pedicureData";
import cigliaSopracciglia from "@/data/cigliaSopraccigliaData";
import massaggi from "@/data/massaggiData";
import ceretta from "@/data/cerettaData";
import rituali from "@/data/ritualiData";
import makeup from "@/data/makeupData";
import trattamentiViso from "@/data/trattamentiVisoData";
import trattamentiCorpo from "@/data/trattamentiCorpoData";
import bagnoTurco from "@/data/bagnoTurcoData";
import Link from "next/link";

function ServicesContainer() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollContainerRef = useRef(null);

  const handleScroll = () => {
    const scrollPosition = scrollContainerRef.current.scrollLeft;
    const containerWidth = scrollContainerRef.current.offsetWidth;
    const newIndex = Math.round(scrollPosition / containerWidth);
    setCurrentIndex(newIndex);
  };

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    scrollContainer.addEventListener("scroll", handleScroll);

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div className="m-auto mt-2 w-[90vw] md:mt-12 md:w-[70vw] ">
      <div className="flex flex-col gap-2 py-8 pb-6 md:gap-4 md:py-4">
        <h4 className="text-xs font-extrabold text-primary ">ESPLORA</h4>
        <h2 className="font-serif text-3xl font-bold tracking-tight md:text-3xl">
          I nostri trattamenti
        </h2>
      </div>
      <div
        ref={scrollContainerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto md:flex-col md:overflow-x-visible"
      >
        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Bagno Turco"
            description="Seduta di bagno turco con aromaterapia e cromoterapia: ideale per purificare l'organismo attraverso la sudorazione, beneficiando il sistema nervoso, la pelle, e migliorando la circolazione sanguigna e linfatica."
            image={bagnoTurcoPic}
            imagePosition="right"
          >
            <div className="grid gap-8 px-6 py-8 md:grid-cols-3 md:px-12 md:py-12">
              {bagnoTurco.map((service, index) => (
                <div className="flex flex-col gap-2" key={index}>
                  <h3 className="font-serif text-[1.3rem] font-bold">
                    {service.title}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Image
                      src={clock}
                      width={18}
                      height={18}
                      alt="duration of the service"
                      style={{
                        maxWidth: "100%",
                        height: "auto"
                      }} />
                    <p className="text-sm font-normal text-gray-500">
                      {service.duration}m
                    </p>
                  </div>
                  <p className="text-sm font-light">{service.description}</p>
                </div>
              ))}
            </div>
          </Accordion>
        </div>
        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Mani e piedi"
            description="Rivitalizza le tue mani e i tuoi piedi con i nostri trattamenti specializzati. Offriamo manicure e pedicure di alta qualità, scrub esfolianti e massaggi rilassanti per donare morbidezza e bellezza alla tua pelle."
            image={maniPiedi}
            imagePosition="left"
          >
            <div className="grid gap-12 px-6 pb-4 md:grid-cols-2 md:px-12 md:py-12">
              <div className=" flex flex-col gap-10  pt-8">
                {manicure.map((service, index) => (
                  <div className="flex flex-col gap-2" key={index}>
                    <h3 className="font-serif text-[1.3rem] font-bold">
                      {service.title}
                    </h3>
                    <div className="flex items-center gap-1">
                      <Image
                        src={clock}
                        width={18}
                        height={18}
                        alt="duration of the service"
                        style={{
                          maxWidth: "100%",
                          height: "auto"
                        }} />
                      <p className="text-sm font-normal text-gray-500">
                        {service.duration}m
                      </p>
                    </div>
                    <p className="text-sm font-light">{service.description}</p>
                    {service.subcategories && (
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {service.subcategories.map((subcategory, subIndex) => (
                          <div className="flex flex-col gap-2" key={subIndex}>
                            <div className="flex items-center gap-1">
                              <Image
                                src={clock}
                                width={18}
                                height={18}
                                alt="duration of the service"
                                style={{
                                  maxWidth: "100%",
                                  height: "auto"
                                }} />
                              <p className="text-sm font-normal text-gray-500">
                                +{subcategory.duration}m
                              </p>
                            </div>
                            <h4 className="w-[85%] text-xs font-medium text-gray-600">
                              {subcategory.title}
                            </h4>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-10">
                {pedicure.map((service, index) => (
                  <div className="flex flex-col gap-2" key={index}>
                    <h3 className="font-serif text-[1.3rem] font-bold">
                      {service.title}
                    </h3>
                    <div className="flex items-center gap-1">
                      <Image
                        src={clock}
                        width={18}
                        height={18}
                        alt="duration of the service"
                        style={{
                          maxWidth: "100%",
                          height: "auto"
                        }} />
                      <p className="text-sm font-normal text-gray-500">
                        {service.duration}m
                      </p>
                    </div>
                    <p className="text-sm font-light">{service.description}</p>
                    {service.subcategories && (
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {service.subcategories.map((subcategory, subIndex) => (
                          <div className="flex flex-col gap-2" key={subIndex}>
                            <div className="flex items-center gap-1">
                              <Image
                                src={clock}
                                width={18}
                                height={18}
                                alt="duration of the service"
                                style={{
                                  maxWidth: "100%",
                                  height: "auto"
                                }} />
                              <p className="text-sm font-normal text-gray-500">
                                +{subcategory.duration}m
                              </p>
                            </div>
                            <h4 className="w-[85%] text-xs font-medium text-gray-600">
                              {subcategory.title}
                            </h4>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Accordion>
        </div>
        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Ciglia e sopracciglia"
            description="Definisci il tuo sguardo con i nostri trattamenti per ciglia e sopracciglia. Offriamo laminazione, extension e design delle sopracciglia per uno sguardo intenso e affascinante."
            image={ciglia}
            imagePosition="right"
          >
            <div className="grid gap-8 px-6 py-8 md:grid-cols-3 md:px-12 md:py-12">
              {cigliaSopracciglia.map((service, index) => (
                <div className="flex flex-col gap-2" key={index}>
                  <h3 className="font-serif text-[1.3rem] font-bold">
                    {service.title}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Image
                      src={clock}
                      width={18}
                      height={18}
                      alt="duration of the service"
                      style={{
                        maxWidth: "100%",
                        height: "auto"
                      }} />
                    <p className="text-sm font-normal text-gray-500">
                      {service.duration}m
                    </p>
                  </div>
                  <p className="text-sm font-light">{service.description}</p>
                </div>
              ))}
            </div>
          </Accordion>
        </div>

        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Massaggi viso e corpo"
            description="Concediti un momento di relax con i nostri massaggi viso e corpo. Tecniche personalizzate per alleviare lo stress, migliorare la circolazione e tonificare la pelle, per un benessere completo."
            image={massaggiPic}
            imagePosition="left"
          >
            <div className="grid gap-8 px-6 py-8 md:grid-cols-2 md:px-12 md:py-12">
              {massaggi.map((service, index) => (
                <div className="flex flex-col gap-2" key={index}>
                  <h3 className="font-serif text-[1.3rem] font-bold">
                    {service.title}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Image
                      src={clock}
                      width={18}
                      height={18}
                      alt="duration of the service"
                      style={{
                        maxWidth: "100%",
                        height: "auto"
                      }} />
                    {service.duration && (
                      <p className="text-sm font-normal text-gray-500">
                        {service.duration}m
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-light">{service.description}</p>
                </div>
              ))}
            </div>
          </Accordion>
        </div>

        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Ceretta"
            description="Dimentica la rasatura quotidiana con i nostri servizi di ceretta professionale. Offriamo trattamenti per tutte le aree del corpo, utilizzando prodotti di alta qualità per una pelle liscia e setosa a lungo."
            image={cerettaPic}
            imagePosition="right"
          >
            <div className="flex flex-col">
              {ceretta.map((service, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-8 px-6 py-8 md:px-12 md:py-12"
                >
                  <div className="flex flex-col gap-2">
                    <h3 className="font-serif text-[1.3rem] font-bold">
                      {service.title}
                    </h3>
                    <div className="flex items-center gap-1">
                      {service.duration && (
                        <p className="text-xs font-normal text-gray-500">
                          {service.duration}m
                        </p>
                      )}
                    </div>
                    <p className="text-sm font-light md:w-[50%]">
                      {service.description}
                    </p>
                  </div>

                  {service.subcategories && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-7">
                      {service.subcategories.map((subcategory, subIndex) => (
                        <div className="flex flex-col gap-2" key={subIndex}>
                          <div className="flex items-center gap-1">
                            <Image
                              src={clock}
                              width={18}
                              height={18}
                              alt="duration of the service"
                              style={{
                                maxWidth: "100%",
                                height: "auto"
                              }} />
                            <p className="text-sm font-normal text-gray-500">
                              {subcategory.duration}m
                            </p>
                          </div>
                          <h4 className="w-[85%] text-sm font-medium text-gray-600">
                            {subcategory.title}
                          </h4>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Accordion>
        </div>
        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Rituali dal mondo"
            description="I rituali dal mondo propongono un’esperienza multisensoriale profondamente immersiva, a partire dagli aromi. Gli ingredienti e le pratiche proposte provengono direttamente dalle millenarie tradizioni di bellezza."
            image={rituale}
            imagePosition="left"
          >
            <div className="px-6 pb-12 md:px-12">
              <div className="flex flex-col gap-4 py-10">
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1">
                    <Image
                      src={clock}
                      width={18}
                      height={18}
                      alt="duration of the service"
                      style={{
                        maxWidth: "100%",
                        height: "auto"
                      }} />
                    <p className="text-sm font-normal text-gray-500">60m</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-700">
                    ESFOLIAZIONE, IMPACCO E APPLICAZIONE DELLA CREMA
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1">
                    <Image
                      src={clock}
                      width={18}
                      height={18}
                      alt="duration of the service"
                      style={{
                        maxWidth: "100%",
                        height: "auto"
                      }} />
                    <p className="text-sm font-normal text-gray-500">90m</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-700">
                    ESFOLIAZIONE, IMPACCO E MASSAGGIO DI 30 MINUTI
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
                {rituali.map((service, index) => (
                  <div className="flex flex-col gap-2" key={index}>
                    <h3 className="font-serif text-[1.3rem] font-bold">
                      {service.title}
                    </h3>
                    <div className="flex items-center gap-1">
                      {service.duration && (
                        <p className="text-sm font-normal text-gray-500">
                          {service.duration}m
                        </p>
                      )}
                    </div>
                    <p className="text-sm font-light">{service.description}</p>
                    {service.subcategories && (
                      <div className="py-6">
                        {service.subcategories.map((subcategory, subIndex) => (
                          <div className="flex flex-col gap-2" key={subIndex}>
                            <div className="flex items-center gap-1">
                              <Image
                                src={clock}
                                width={18}
                                height={18}
                                alt="duration of the service"
                                style={{
                                  maxWidth: "100%",
                                  height: "auto"
                                }} />
                              <p className="text-sm font-normal text-gray-500">
                                {subcategory.duration}m
                              </p>
                            </div>
                            <h4 className="w-[85%] text-xs font-medium text-gray-600">
                              {subcategory.title}
                            </h4>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Accordion>
        </div>

        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Make-up e acconciature"
            description="Esalta la tua bellezza naturale con i nostri servizi di make-up e acconciature. Dai look quotidiani alle occasioni speciali, i nostri esperti ti aiuteranno a trovare lo stile perfetto per te."
            image={makeupPic}
            imagePosition="right"
          >
            <div className="grid grid-cols-1 gap-8 px-6 py-8 md:grid-cols-3 md:px-12 md:py-12">
              {makeup.map((service, index) => (
                <div className="flex flex-col gap-2" key={index}>
                  <h3 className="font-serif text-[1.3rem] font-bold">
                    {service.title}
                  </h3>
                  {service.duration && (
                    <div className="flex items-center gap-1">
                      <Image
                        src={clock}
                        width={18}
                        height={18}
                        alt="duration of the service"
                        style={{
                          maxWidth: "100%",
                          height: "auto"
                        }} />
                      <p className="text-sm font-normal text-gray-500">
                        {service.duration}m
                      </p>
                    </div>
                  )}
                  <p className="text-sm font-light">{service.description}</p>
                  {service.subcategories && (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      {service.subcategories.map((subcategory, subIndex) => (
                        <div className="flex flex-col gap-2" key={subIndex}>
                          <div className="flex items-center gap-1">
                            <Image
                              src={clock}
                              width={18}
                              height={18}
                              alt="duration of the service"
                              style={{
                                maxWidth: "100%",
                                height: "auto"
                              }} />
                            <p className="text-sm font-normal text-gray-500">
                              {subcategory.duration}m
                            </p>
                          </div>
                          <h4 className="w-[85%] text-xs font-medium text-gray-600">
                            {subcategory.title}
                          </h4>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Accordion>
        </div>

        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Trattamenti viso"
            description="Riscopri la luminosità della tua pelle con i nostri trattamenti viso. Da pulizie profonde a trattamenti anti-età, personalizziamo ogni servizio per rispondere alle esigenze specifiche della tua pelle."
            image={viso}
            imagePosition="left"
          >
            <div className="grid grid-cols-1 gap-8 px-6 py-8 md:grid-cols-2 md:px-12 md:py-12">
              {trattamentiViso.map((service, index) => (
                <div className="flex flex-col gap-2" key={index}>
                  <h3 className="font-serif text-[1.3rem] font-bold">
                    {service.title}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Image
                      src={clock}
                      width={18}
                      height={18}
                      alt="duration of the service"
                      style={{
                        maxWidth: "100%",
                        height: "auto"
                      }} />
                    {service.duration && (
                      <p className="text-sm font-normal text-gray-500">
                        {service.duration}m
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-light">{service.description}</p>
                  {service.subcategories && (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      {service.subcategories.map((subcategory, subIndex) => (
                        <div className="flex flex-col gap-2" key={subIndex}>
                          <div className="flex items-center gap-1">
                            <Image
                              src={tick}
                              width={18}
                              height={18}
                              alt="subcategory indicator"
                              style={{
                                maxWidth: "100%",
                                height: "auto"
                              }} />
                            {subcategory.duration && (
                              <p className="text-sm font-normal text-gray-500">
                                {subcategory.duration}m
                              </p>
                            )}
                          </div>
                          <h4 className="w-[85%] text-xs font-medium text-gray-600">
                            {subcategory.title}
                          </h4>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Accordion>
        </div>

        <div className="min-w-full snap-center">
          <Accordion
            className="w-full flex-shrink-0 md:w-auto"
            title="Trattamenti corpo"
            description="Protocolli termali a base di alghe e attivi di Bretagna ad alta
efficacia cosmetologica indicati per rimodellare, tonificare e
trattare tutti gli inestetismi del corpo. Permettono una
detossinazione profonda e un riequilibrio delle funzioni
metaboliche, in totale relax."
            image={viso}
            imagePosition="right"
          >
            <div className="grid grid-cols-1 gap-8 px-6 py-8 md:grid-cols-2 md:px-12 md:py-12">
              {trattamentiCorpo.map((service, index) => (
                <div className="flex flex-col gap-2" key={index}>
                  <h3 className="font-serif text-[1.3rem] font-bold">
                    {service.title}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Image
                      src={clock}
                      width={18}
                      height={18}
                      alt="duration of the service"
                      style={{
                        maxWidth: "100%",
                        height: "auto"
                      }} />
                    {service.duration && (
                      <p className="text-sm font-normal text-gray-500">
                        {service.duration}m
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-light">{service.description}</p>
                  {service.subcategories && (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      {service.subcategories.map((subcategory, subIndex) => (
                        <div className="flex flex-col gap-2" key={subIndex}>
                          <div className="flex items-center gap-1">
                            <Image
                              src={tick}
                              width={18}
                              height={18}
                              alt="subcategory indicator"
                              style={{
                                maxWidth: "100%",
                                height: "auto"
                              }} />
                            {subcategory.duration && (
                              <p className="text-sm font-normal text-gray-500">
                                {subcategory.duration}m
                              </p>
                            )}
                          </div>
                          <h4 className="w-[85%] text-xs font-medium text-gray-600">
                            {subcategory.title}
                          </h4>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Accordion>
        </div>
      </div>
      <div className=" flex justify-center p-2 lg:hidden">
        {[...Array(7).keys()].map((_, index) => (
          <div
            key={index}
            className={`mx-1 h-1 w-1 rounded-full ${
              currentIndex === index ? "bg-primary" : "bg-gray-200"
            }`}
          ></div>
        ))}
      </div>
      <div className="text-center p-6">
        <Link
          className="underline text-zinc-400 w-fit cursor-pointer text-center  text-sm font-semibold"
          target="_blank"
          href={
            "https://drive.google.com/file/d/1syZzcDt0su9ZMX1wDMI0s_iwZW8IJo6a/view?usp=sharing"
          }
        >
          SCOPRI IL LISTINO PREZZI →
        </Link>
      </div>
    </div>
  );
}

export default ServicesContainer;
