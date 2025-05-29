// components/AppointmentCalendar.jsx

import React from "react";
import { Calendar } from "@/components/ui/calendar";

export function AppointmentCalendar({
  appointments,
  selectedDate,
  setSelectedDate,
}) {
  const filteredAppointments = appointments.filter(
    (appointment) =>
      new Date(appointment.selectedDate).toDateString() ===
      selectedDate.toDateString()
  );

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString("it-IT", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleDateSelect = (date) => {
    if (date) {
      setSelectedDate(date);
    }
  };

  return (
    <div className="flex gap-6 w-full">
      {/* Calendar Component */}
      <div className="rounded-lg border bg-background p-4 h-full">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          initialFocus
        />
      </div>

      {/* Appointments List */}
      <div className="rounded-lg border bg-background p-6">
        <h2 className="text-lg font-medium">
          Appuntamenti per {formatDate(selectedDate)}
        </h2>
        <div className="mt-4 grid gap-4">
          {filteredAppointments.map((appointment) => (
            <div key={appointment.id} className="flex items-start gap-4">
              <div className="flex-none rounded-md bg-muted px-2 py-1 text-xs font-medium">
                {appointment.startTime}
              </div>
              <div className="flex-1">
                <h3 className="text-base font-medium">
                  {appointment.appointmentType}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {appointment.name} - {appointment.email}
                </p>
                <p className="text-sm text-muted-foreground">
                  {appointment.duration} minuti
                </p>
              </div>
            </div>
          ))}
          {filteredAppointments.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nessun appuntamento per questa data
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
