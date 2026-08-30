"use client";

import Link from "next/link";
import { preloadBookingExperience } from "@/components/booking/DeferredBookingExperience";

export default function BookingIntentLink({ children, ...props }) {
  return (
    <Link
      {...props}
      onFocus={preloadBookingExperience}
      onPointerEnter={preloadBookingExperience}
      onTouchStart={preloadBookingExperience}
    >
      {children}
    </Link>
  );
}
