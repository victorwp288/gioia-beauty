"use client";

import { enGB, it } from "date-fns/locale";

import { Calendar } from "@/components/ui/calendar";

export default function BookingCalendar({ locale = "it", ...props }) {
  return (
    <Calendar
      locale={locale === "en" ? enGB : it}
      weekStartsOn={1}
      {...props}
    />
  );
}
