"use client";
import React, { useState, useEffect, useMemo } from "react";
import { Controller } from "react-hook-form";
import { Clock } from "lucide-react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

// UI Components
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

// Context and Hooks
import { useAppointmentContext } from "@/context/AppointmentContext";
import { useNotification } from "@/context/NotificationContext";
import { useBookingForm } from "@/hooks/useBookingForm";
import {
  useOptimizedTimeSlots,
  timeSlotsUtils,
} from "@/hooks/useOptimizedTimeSlots";

// Utilities
import { APPOINTMENT_TYPES, getAppointmentType } from "@/lib/utils/constants";
import {
  isBusinessDay,
  isInVacationPeriod,
  getNextBusinessDay,
} from "@/lib/utils/timeUtils";
import { formatDate } from "@/lib/utils/dateUtils";

// Components
import BookingConfirmation from "./BookingConfirmation";

const BookAppointment = () => {
  // Context hooks
  const {
    selectedDate,
    selectedTimeSlot,
    vacationPeriods,
    setSelectedDate,
    setSelectedTimeSlot,
    createAppointment,
    loading,
  } = useAppointmentContext();

  const { showSuccess, showError, notifyAsync } = useNotification();

  // Local state (must be declared before hooks that use them)
  const [appointmentType, setAppointmentType] = useState(() => {
    // Get the first available appointment type from the new data structure
    const firstAvailableType = Object.values(APPOINTMENT_TYPES).find(
      (type) => type.active
    );
    return firstAvailableType || null;
  });
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [showAllTimeSlots, setShowAllTimeSlots] = useState(false);
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [bookingData, setBookingData] = useState(null);
  const [isClient, setIsClient] = useState(false);

  // Custom hooks
  const { form, formState, resetForm } = useBookingForm();

  // Ensure client-side rendering for appointment types to avoid hydration issues
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Memoize duration to prevent unnecessary hook re-renders
  const currentDuration = useMemo(() => {
    if (
      !appointmentType ||
      !appointmentType.durations ||
      appointmentType.durations.length === 0
    ) {
      return 60; // Default duration if no appointment type selected
    }
    return selectedVariant || appointmentType.durations[0];
  }, [selectedVariant, appointmentType]);

  // Optimized time slots with real-time updates and caching
  const {
    timeSlots: availableTimeSlots,
    loading: timeSlotsLoading,
    refreshTimeSlots,
    getTimeSlotsForDate,
    isDateAvailable,
  } = useOptimizedTimeSlots(
    selectedDate,
    appointmentType?.type,
    currentDuration,
    {
      enableRealTime: false, // DISABLED: Reduce Firebase reads during testing
      preloadDays: 0, // DISABLED: No background preloading
      bufferMinutes: 10, // Buffer time between appointments for salon setup/cleanup
    }
  );

  const initialVisibleSlots = 12;

  // Initialize with next available date
  useEffect(() => {
    if (!selectedDate) {
      const nextDate = getNextBusinessDay(new Date());
      setSelectedDate(nextDate);
      form.setValue("selectedDate", nextDate);
      form.setValue("date", nextDate);
    }
  }, [selectedDate, setSelectedDate, form]);

  // Initialize appointment type in form
  useEffect(() => {
    if (appointmentType) {
      form.setValue("appointmentType", appointmentType.type);
      form.setValue("duration", appointmentType.durations?.[0] || 60);
    }
  }, [appointmentType, form]);

  // Note: Time slots are automatically updated by the useTimeSlots hook when parameters change

  // Function to check if a day should be disabled
  const isDisabledDay = (day) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return (
      // Vacation periods
      // Weekends
      (day <= today || // Past dates and today
      !isBusinessDay(day) || isInVacationPeriod(day, vacationPeriods))
    );
  };

  // Handle appointment type change
  const handleAppointmentTypeChange = (e) => {
    const selectedType = getAppointmentType(e.target.value);
    if (selectedType) {
      setAppointmentType(selectedType);
      setSelectedVariant(null); // Reset variant

      // Update form values
      form.setValue("appointmentType", selectedType.type);
      form.setValue("duration", selectedType.durations[0]);

      // If only one duration, auto-select it
      if (selectedType.durations.length === 1) {
        setSelectedVariant(selectedType.durations[0]);
        form.setValue("variant", selectedType.durations[0].toString());
      } else {
        // Multiple durations, user needs to choose
        form.setValue("variant", "");
      }
    }
  };

  // Handle duration/variant change
  const handleVariantChange = (e) => {
    const duration = parseInt(e.target.value);
    setSelectedVariant(duration);
    form.setValue("duration", duration);
    form.setValue("variant", duration.toString());
  };

  // Handle date selection
  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setSelectedTimeSlot(null); // Reset time slot when date changes
    form.setValue("date", date);
    form.setValue("selectedDate", date);
    form.setValue("timeSlot", ""); // Reset time slot in form
  };

  // Handle time slot selection
  const handleTimeSlotSelect = (timeSlot) => {
    setSelectedTimeSlot(timeSlot);
    form.setValue("timeSlot", timeSlot);
  };

  // Form submission handler
  const handleSubmit = async (data) => {
    try {
      // Import unified date utilities
      const { createAppointmentDate } = await import("@/lib/utils/dateUtils");

      console.log("📅 BookAppointment: Submitting appointment data:", data);

      // Create standardized appointment date using unified system
      const standardizedDate = createAppointmentDate(data.selectedDate);
      if (!standardizedDate) {
        throw new Error("Invalid appointment date selected");
      }

      console.log("📅 BookAppointment: Standardized date:", {
        original: data.selectedDate,
        standardized: standardizedDate,
      });

      // Prepare appointment data
      const appointmentData = {
        name: data.name.trim(),
        email: data.email.trim(),
        number: data.number,
        appointmentType: data.appointmentType,
        duration: data.duration,
        selectedDate: standardizedDate, // Use standardized date
        startTime: data.timeSlot,
        note: data.note?.trim() || "",
        variant: data.variant || "",
        status: "confirmed",
      };

      // Calculate end time
      const [hours, minutes] = data.timeSlot.split(":").map(Number);
      const totalMinutes = hours * 60 + minutes + data.duration;
      const endHours = Math.floor(totalMinutes / 60) % 24;
      const endMinutes = totalMinutes % 60;
      appointmentData.endTime = `${String(endHours).padStart(2, "0")}:${String(
        endMinutes
      ).padStart(2, "0")}`;

      console.log(
        "📅 BookAppointment: Final appointment data:",
        appointmentData
      );

      // Create appointment using context
      await notifyAsync(() => createAppointment(appointmentData), {
        loading: "Prenotazione in corso...",
        success: "Appuntamento prenotato con successo!",
        error: "Errore nella prenotazione. Riprova.",
      });

      // Send confirmation email for new appointments
      try {
        const emailData = {
          email: appointmentData.email,
          name: appointmentData.name,
          startTime: appointmentData.startTime,
          endTime: appointmentData.endTime,
          duration: appointmentData.duration,
          date: (() => {
            try {
              if (appointmentData.selectedDate instanceof Date) {
                return formatDate(appointmentData.selectedDate);
              } else if (typeof appointmentData.selectedDate === "string") {
                const parsedDate = new Date(appointmentData.selectedDate);
                return isNaN(parsedDate.getTime())
                  ? "Unknown Date"
                  : formatDate(parsedDate);
              } else if (appointmentData.selectedDate?.toDate) {
                return formatDate(appointmentData.selectedDate.toDate());
              } else if (appointmentData.selectedDate?.seconds) {
                return formatDate(
                  new Date(appointmentData.selectedDate.seconds * 1000)
                );
              } else {
                return "Unknown Date";
              }
            } catch (error) {
              console.error("Error formatting date for email:", error);
              return "Unknown Date";
            }
          })(),
          appointmentType: appointmentData.appointmentType,
        };

        const response = await fetch("/api/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(emailData),
        });

        if (!response.ok) {
          console.warn(
            "Failed to send confirmation email:",
            response.statusText
          );
        } else {
          console.log("✅ Confirmation email sent successfully");
        }
      } catch (emailError) {
        console.warn("Email sending failed:", emailError);
        // Don't fail the appointment creation if email fails
      }

      // Store booking data for confirmation modal
      setBookingData({
        ...appointmentData,
        formattedDate: formatDate(appointmentData.selectedDate),
        appointmentTypeDisplay: appointmentType.type,
        durationDisplay: `${appointmentData.duration} minuti`,
      });

      // Reset form and open confirmation modal
      resetForm();
      setSelectedTimeSlot(null);
      setModalIsOpen(true);
    } catch (error) {
      console.error("Error booking appointment:", error);
      // Error handling is done by notifyAsync
    }
  };

  // Handle form submission with validation feedback
  const handleFormSubmit = form.handleSubmit(
    // Success callback - called when validation passes
    (data) => {
      handleSubmit(data);
    },
    // Error callback - called when validation fails
    (errors) => {
      console.log("Form validation errors:", errors);

      // Collect missing required fields in Italian
      const missingFields = [];
      if (errors.name) missingFields.push("Nome e Cognome");
      if (errors.email) missingFields.push("Email");
      if (errors.number) missingFields.push("Numero di telefono");
      if (errors.timeSlot) missingFields.push("Orario");
      if (errors.selectedDate || errors.date) missingFields.push("Data");
      if (errors.appointmentType) missingFields.push("Trattamento");
      if (errors.duration) missingFields.push("Durata del trattamento");

      // Show error notification
      showError(
        `Compila tutti i campi obbligatori prima di prenotare: ${missingFields.join(
          ", "
        )}`,
        { duration: 6000 }
      );

      // Scroll to first error field
      const firstErrorField = Object.keys(errors)[0];
      const firstErrorElement = document.querySelector(
        `[name="${firstErrorField}"]`
      );
      if (firstErrorElement) {
        firstErrorElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        firstErrorElement.focus();
      }
    }
  );

  const openModal = () => setModalIsOpen(true);
  const closeModal = () => setModalIsOpen(false);

  return (
    <div className="m-auto mt-12 w-[90vw] space-y-4 md:w-[70vw]">
      {/* Header */}
      <div className="flex flex-col gap-2 py-1 md:gap-4 md:py-4">
        <h4 className="text-xs font-extrabold text-primary">
          CONCEDITI UN MOMENTO DI RELAX
        </h4>
        <h2 className="font-serif text-3xl font-bold tracking-tight md:text-3xl">
          Prenota un appuntamento
        </h2>
      </div>

      {/* Form */}
      <Form {...form}>
        <form onSubmit={handleFormSubmit}>
          <div className="grid grid-cols-1 items-end gap-8 md:grid-cols-2">
            {/* Calendar */}
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Seleziona data*</FormLabel>
                  <FormControl>
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={handleDateSelect}
                      disabled={isDisabledDay}
                      className="w-fit rounded-md border"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Time Slots */}
            <FormField
              control={form.control}
              name="timeSlot"
              render={({ field }) => (
                <FormItem className="mt-3 md:mt-0">
                  <FormLabel className="mb-3 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    Seleziona orario*
                  </FormLabel>
                  <FormControl>
                    <div className="space-y-4">
                      {timeSlotsLoading ? (
                        <div className="flex h-32 items-center justify-center rounded-lg border">
                          <div className="text-muted-foreground">
                            Caricamento orari disponibili...
                          </div>
                        </div>
                      ) : !availableTimeSlots ||
                        availableTimeSlots.length === 0 ? (
                        <div className="flex h-32 items-center justify-center rounded-lg border">
                          <div className="text-muted-foreground">
                            Nessun orario disponibile per questa data
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-2 rounded-lg border p-5">
                            {(showAllTimeSlots
                              ? availableTimeSlots || []
                              : (availableTimeSlots || []).slice(
                                  0,
                                  initialVisibleSlots
                                )
                            ).map((timeSlot, index) => (
                              <Button
                                key={index}
                                type="button"
                                variant={
                                  timeSlot === selectedTimeSlot
                                    ? "default"
                                    : "outline"
                                }
                                className="h-auto p-2 text-sm"
                                onClick={() => handleTimeSlotSelect(timeSlot)}
                              >
                                {timeSlot}
                              </Button>
                            ))}
                          </div>

                          {(availableTimeSlots?.length || 0) >
                            initialVisibleSlots && (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full"
                              onClick={() =>
                                setShowAllTimeSlots(!showAllTimeSlots)
                              }
                            >
                              {showAllTimeSlots
                                ? "Mostra meno"
                                : `Mostra più (${
                                    (availableTimeSlots?.length || 0) -
                                    initialVisibleSlots
                                  } altri)`}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Appointment Type */}
            <FormField
              control={form.control}
              name="appointmentType"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Trattamento*</FormLabel>
                  <FormControl>
                    <select
                      className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow disabled:cursor-not-allowed disabled:opacity-50 ${
                        fieldState.error
                          ? "border-red-500 focus:border-red-500"
                          : "border-input"
                      }`}
                      {...field}
                      onChange={handleAppointmentTypeChange}
                    >
                      <option value="">Seleziona trattamento</option>
                      {isClient ? (
                        (() => {
                          // Group appointment types by category
                          const groupedTypes = {};
                          Object.entries(APPOINTMENT_TYPES)
                            .filter(([key, type]) => type.active)
                            .forEach(([key, type]) => {
                              if (!groupedTypes[type.categoryName]) {
                                groupedTypes[type.categoryName] = [];
                              }
                              groupedTypes[type.categoryName].push({
                                key,
                                type,
                              });
                            });

                          return Object.entries(groupedTypes)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([categoryName, types]) => (
                              <optgroup key={categoryName} label={categoryName}>
                                {types
                                  .sort((a, b) =>
                                    a.type.type.localeCompare(b.type.type)
                                  )
                                  .map(({ key, type }) => (
                                    <option key={key} value={type.type}>
                                      {type.type}
                                    </option>
                                  ))}
                              </optgroup>
                            ));
                        })()
                      ) : (
                        <option disabled>Caricamento servizi...</option>
                      )}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Duration/Variant Selection */}
            {appointmentType && appointmentType.durations && (
              <FormField
                control={form.control}
                name="variant"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>
                      Durata del trattamento*
                      {appointmentType.durations.length > 1 &&
                        ` (${appointmentType.durations.length} opzioni)`}
                    </FormLabel>
                    <FormControl>
                      <select
                        className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow disabled:cursor-not-allowed disabled:opacity-50 ${
                          fieldState.error
                            ? "border-red-500 focus:border-red-500"
                            : "border-input"
                        }`}
                        {...field}
                        onChange={handleVariantChange}
                      >
                        {appointmentType.durations.length > 1 ? (
                          <option value="">Seleziona durata</option>
                        ) : null}
                        {appointmentType.durations.map((duration, index) => (
                          <option key={index} value={duration}>
                            {duration} minuti
                            {appointmentType.variants?.[index] &&
                              appointmentType.variants[index] !==
                                appointmentType.type &&
                              ` - ${appointmentType.variants[index]}`}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Note */}
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="Note aggiuntive (opzionale)"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Nome e Cognome*</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="Es. Mario Rossi"
                      className={
                        fieldState.error
                          ? "border-red-500 focus:border-red-500"
                          : ""
                      }
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Email*</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="mario.rossi@example.com"
                      className={
                        fieldState.error
                          ? "border-red-500 focus:border-red-500"
                          : ""
                      }
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Phone Number */}
            <FormField
              control={form.control}
              name="number"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Numero di telefono*</FormLabel>
                  <FormControl>
                    <PhoneInput
                      country={"it"}
                      value={field.value}
                      onChange={(phone, country, e, formattedValue) => {
                        field.onChange(formattedValue);
                      }}
                      inputStyle={{
                        height: "2.5rem",
                        width: "100%",
                        borderRadius: "0.375rem",
                        borderColor: fieldState.error ? "#ef4444" : "#e2e8f1",
                        backgroundColor: "#ffffff",
                        fontSize: "0.875rem",
                      }}
                      containerStyle={{
                        marginTop: "0.5rem",
                      }}
                      buttonStyle={{
                        borderColor: fieldState.error ? "#ef4444" : "#e2e8f1",
                        backgroundColor: "#ffffff",
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Submit Button */}
          <div className="mt-8 flex justify-center">
            <Button
              type="submit"
              className="w-full md:w-auto px-8 py-3"
              disabled={loading || !selectedDate || !selectedTimeSlot}
            >
              {loading ? "Prenotazione in corso..." : "Prenota Appuntamento"}
            </Button>
          </div>

          {/* Helper text for required fields */}
          <div className="mt-4 text-center">
            <p className="text-sm text-muted-foreground">
              I campi contrassegnati con * sono obbligatori
            </p>
          </div>
        </form>
      </Form>

      {/* Booking Confirmation Modal */}
      {modalIsOpen && bookingData && (
        <BookingConfirmation
          isOpen={modalIsOpen}
          onRequestClose={closeModal}
          bookingData={bookingData}
        />
      )}
    </div>
  );
};

export default BookAppointment;
