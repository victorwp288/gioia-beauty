"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { bookingContent } from "@/lib/content/bookingContent";

const loadBookingExperience = () =>
  import("@/components/booking/BookingExperience");

function BookingHeading({ locale }) {
  const copy = bookingContent(locale);
  return (
    <section
      className="mx-auto w-[90vw] py-14 md:w-[70vw]"
      aria-labelledby="deferred-booking-heading"
    >
      <p className="text-xs font-extrabold uppercase text-primary">
        {copy.eyebrow}
      </p>
      <h2
        id="deferred-booking-heading"
        className="mt-2 font-serif text-3xl font-bold"
      >
        {copy.heading}
      </h2>
      <p className="mt-4 text-sm text-slate-600">{copy.intro}</p>
    </section>
  );
}

const BookingExperience = dynamic(loadBookingExperience, {
  ssr: false,
  loading: () => null,
});

export function preloadBookingExperience() {
  return loadBookingExperience();
}

export default function DeferredBookingExperience({
  locale = "it",
  showNewsletter = true,
}) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const sentinelRef = useRef(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || shouldLoad) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <div
      ref={sentinelRef}
      className="min-h-screen flow-root"
      onFocus={preloadBookingExperience}
      onPointerEnter={preloadBookingExperience}
      onTouchStart={preloadBookingExperience}
    >
      <BookingHeading locale={locale} />
      {shouldLoad ? (
        <BookingExperience
          locale={locale}
          showHeading={false}
          showNewsletter={showNewsletter}
        />
      ) : null}
    </div>
  );
}
