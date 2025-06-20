import Link from "next/link";
import Image from "next/image";
import rituale from "@/images/rituale.jpg";
import downArrow from "@/images/down-arrow.svg";
import { reception4 } from "@/components/ImagesExports";

function HeroSection() {
  return (
    <div className=" relative  h-screen bg-cover bg-center  md:mt-10 md:h-[95vh]">
      <Image
        className="h-full w-full object-cover"
        src={reception4}
        alt="duration of the service"
        fill
        sizes="100vw"
        priority
      />
      <div className="absolute inset-0 flex items-center">
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 from-10% to-transparent"></div>
        <div className="relative flex flex-col gap-8 p-6 md:pl-12">
          <h1 className="  text-left text-base font-semibold leading-tight text-white md:w-[60vw] md:text-2xl">
            Il centro benessere Gioia Beauty si impegna ad offrire
            un&apos;esperienza di bellezza ecosotenibile e vegana, utilizzando
            prodotti di altissima qualità per garantire un servizio eccellente
            rispettando l&apos;ambiente e gli animali.
          </h1>
          <div className="flex flex-col gap-6">
            <Link
              href="#booking-section"
              offset={-80}
              className="w-fit cursor-pointer border border-white p-4 text-base font-medium text-white "
            >
              PRENOTA
            </Link>
            <div className="flex items-center gap-2">
              <Link
                href="#services"
                className="w-fit cursor-pointer   text-sm font-medium text-white "
              >
                Scopri i nostri servizi
              </Link>
              <Image
                src={downArrow}
                alt="down arrow"
                width={16}
                height={16}
                style={{
                  maxWidth: "100%",
                  height: "auto",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HeroSection;
