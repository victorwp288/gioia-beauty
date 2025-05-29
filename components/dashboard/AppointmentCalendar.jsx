"use client";
import React, { useMemo, useState, useEffect } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { formatDate, isToday, isSameDate } from "@/lib/utils/dateUtils";

const AppointmentCalendar = ({ selectedDate, onDateChange, appointments }) => {
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
              appointment.selectedDate + "T00:00:00.000Z"
            );
          }
        } else if (appointment.selectedDate?.toDate) {
          appointmentDate = appointment.selectedDate.toDate();
        } else {
          console.warn(
            "📊 AppointmentCalendar: Unknown date format:",
            appointment.selectedDate
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
          error
        );
      }
    });

    return dateMap;
  }, [appointments]);

  // Custom day content to show appointment indicators
  const DayContent = ({ date }) => {
    // Fix timezone issue: use local date instead of UTC
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateKey = `${year}-${month}-${day}`;

    const dayAppointments = appointmentsByDate.get(dateKey) || [];
    const appointmentCount = dayAppointments.length;

    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center">
        <span className="text-sm">{date.getDate()}</span>
        {appointmentCount > 0 && (
          <div
            className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 pointer-events-none select-none z-10"
            style={{ pointerEvents: "none" }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Badge
              variant="secondary"
              className="h-4 w-4 text-xs p-0 flex items-center justify-center pointer-events-none select-none"
              style={{ pointerEvents: "none" }}
            >
              {appointmentCount}
            </Badge>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Calendar
        mode="single"
        selected={selectedDate}
        onSelect={onDateChange}
        components={{
          DayContent: DayContent,
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
        className="rounded-md border [--appointment-bg:#f0f9ff] [--appointment-border:#0ea5e9] [--appointment-text:#1e40af] [--selected-bg:#3b82f6] [--selected-text:white] dark:[--appointment-bg:#1e3a8a] dark:[--appointment-border:#3b82f6] dark:[--appointment-text:#bfdbfe] dark:[--selected-bg:#60a5fa] dark:[--selected-text:#1f2937]"
      />

      {selectedDate && (
        <div className="text-sm text-muted-foreground">
          Selected: {formatDate(selectedDate)}
          {(() => {
            try {
              // Fix timezone issue: use local date instead of UTC
              const year = selectedDate.getFullYear();
              const month = String(selectedDate.getMonth() + 1).padStart(
                2,
                "0"
              );
              const day = String(selectedDate.getDate()).padStart(2, "0");
              const selectedDateKey = `${year}-${month}-${day}`;

              const appointmentsForDate =
                appointmentsByDate.get(selectedDateKey);
              if (appointmentsForDate && appointmentsForDate.length > 0) {
                return (
                  <span className="ml-2 text-blue-600 dark:text-blue-400">
                    ({appointmentsForDate.length} appointments)
                  </span>
                );
              }
            } catch (error) {
              console.error(
                "Error displaying selected date appointments:",
                error
              );
            }
            return null;
          })()}
        </div>
      )}
    </div>
  );
};

export default AppointmentCalendar;
