"use client";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { isSameDate, isToday } from "@/lib/utils/dateUtils";
import { useMemo } from "react";

const AppointmentCalendar = ({
  selectedDate,
  onDateChange,
  appointments,
  onMonthChange,
}) => {
  // Create a map of dates with appointment counts from appointments prop
  const appointmentsByDate = useMemo(() => {
    const dateMap = new Map();

    appointments.forEach((appointment) => {
      try {
        // Handle different date formats server-side processed data
        let appointmentDate;

        if (appointment.selectedDate instanceof Date) {
          appointmentDate = appointment.selectedDate;
        } else if (typeof appointment.selectedDate === "string") {
          if (appointment.selectedDate.includes("T")) {
            appointmentDate = new Date(appointment.selectedDate);
          } else {
            appointmentDate = new Date(
              appointment.selectedDate + "T00:00:00.000Z",
            );
          }
        } else if (appointment.selectedDate?.toDate) {
          appointmentDate = appointment.selectedDate.toDate();
        } else {
          console.warn(
            "📊 AppointmentCalendar: Unknown date format:",
            appointment.selectedDate,
          );
          return;
        }

        // Fix timezone issue: use local date instead of UTC
        const year = appointmentDate.getFullYear();
        const month = String(appointmentDate.getMonth() + 1).padStart(2, "0");
        const day = String(appointmentDate.getDate()).padStart(2, "0");
        const dateKey = `${year}-${month}-${day}`;

        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, []);
        }
        dateMap.get(dateKey).push(appointment);
      } catch (error) {
        console.error(
          "📊 AppointmentCalendar: Error processing appointment for calendar:",
          appointment.id,
          error,
        );
      }
    });

    return dateMap;
  }, [appointments]);

  // Custom day content to show appointment indicators
  const CalendarDayButton = ({
    day: calendarDay,
    children,
    ...buttonProps
  }) => {
    const date = calendarDay.date;
    // Fix timezone issue: use local date instead of UTC
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateKey = `${year}-${month}-${day}`;

    const dayAppointments = appointmentsByDate.get(dateKey) || [];
    const appointmentCount = dayAppointments.length;

    return (
      <button {...buttonProps}>
        <span className="text-sm">{children}</span>
        {appointmentCount > 0 && (
          <span
            className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 pointer-events-none select-none z-10"
            style={{ pointerEvents: "none" }}
          >
            <Badge
              variant="secondary"
              className="h-4 w-4 text-xs p-0 flex items-center justify-center pointer-events-none select-none"
              style={{ pointerEvents: "none" }}
            >
              {appointmentCount}
            </Badge>
          </span>
        )}
      </button>
    );
  };

  return (
    <Calendar
      mode="single"
      selected={selectedDate}
      onSelect={onDateChange}
      onMonthChange={onMonthChange}
      fixedWeeks
      classNames={{
        months:
          "flex w-full flex-col space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0 lg:h-full",
        month: "w-full space-y-4 lg:flex lg:h-full lg:flex-col",
        month_grid: "w-full table-fixed lg:h-full",
        week: "mt-2 flex w-full lg:mt-1 lg:first:mt-0",
        day: "h-9 flex-1 text-center text-sm p-0 relative lg:h-12 has-data-selected:bg-accent first:has-data-selected:rounded-l-md last:has-data-selected:rounded-r-md focus-within:relative focus-within:z-20",
        day_button:
          "relative inline-flex h-9 w-full items-center justify-center whitespace-nowrap rounded-md p-0 text-sm font-normal ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-selected:opacity-100 lg:h-12",
      }}
      components={{
        DayButton: CalendarDayButton,
      }}
      modifiers={{
        selected: (date) => selectedDate && isSameDate(date, selectedDate),
        today: (date) => isToday(date, new Date()),
        hasAppointments: (date) => {
          // Only apply hasAppointments styling if the date is NOT selected
          if (selectedDate && isSameDate(date, selectedDate)) {
            return false;
          }
          // Fix timezone issue: use local date instead of UTC
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          const dateKey = `${year}-${month}-${day}`;
          return appointmentsByDate.has(dateKey);
        },
      }}
      modifiersStyles={{
        selected: {
          backgroundColor: "var(--selected-bg, #3b82f6)",
          color: "var(--selected-text, white)",
          fontWeight: "600",
          opacity: "0.9",
        },
        today: {
          backgroundColor: "#ef4444",
          color: "white",
        },
        hasAppointments: {
          backgroundColor: "var(--appointment-bg, #f0f9ff)",
          border: "1px solid var(--appointment-border, #0ea5e9)",
          color: "var(--appointment-text, #1e40af)",
        },
      }}
      className="h-full rounded-md border [--appointment-bg:#f0f9ff] [--appointment-border:#0ea5e9] [--appointment-text:#1e40af] [--selected-bg:#3b82f6] [--selected-text:white] dark:[--appointment-bg:#1e3a8a] dark:[--appointment-border:#3b82f6] dark:[--appointment-text:#bfdbfe] dark:[--selected-bg:#60a5fa] dark:[--selected-text:#1f2937]"
    />
  );
};

export default AppointmentCalendar;
