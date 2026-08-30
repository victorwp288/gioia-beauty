"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import BookAppointment from "@/components/booking/BookAppointment";
import { PublicBookingNotificationsProvider } from "@/components/booking/PublicBookingNotifications";

const NewsletterSignup = dynamic(
  () => import("@/components/NewsletterSignup"),
  {
    ssr: false,
  },
);

function DeferredNewsletterSignup() {
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
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <div className="scroll-mt-16" id="newsletter-section" ref={sentinelRef}>
      {shouldLoad ? <NewsletterSignup /> : null}
    </div>
  );
}

export default function BookingExperience({
  locale = "it",
  showHeading = true,
  showNewsletter = true,
}) {
  return (
    <PublicBookingNotificationsProvider locale={locale}>
      <BookAppointment locale={locale} showHeading={showHeading} />
      {showNewsletter ? <DeferredNewsletterSignup /> : null}
    </PublicBookingNotificationsProvider>
  );
}
