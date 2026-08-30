"use client";
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { Clock } from "lucide-react";
import dynamic from "next/dynamic";
import "react-phone-input-2/lib/style.css";

// UI Components
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import TurnstileChallenge from "@/components/common/TurnstileChallenge";

import { usePublicBookingNotifications } from "@/components/booking/PublicBookingNotifications";
import { useBookingForm } from "@/hooks/useBookingForm";
import { useMaintenanceStatus } from "@/hooks/useMaintenanceStatus";
import { useOptimizedTimeSlots } from "@/hooks/useOptimizedTimeSlots";

// Utilities
import { SERVICE_CATALOG } from "@/lib/domain/catalog/index.ts";
import { isBusinessDay } from "@/lib/utils/timeUtils";
import { formatDate } from "@/lib/utils/dateUtils";
import {
  catalogSelectionById,
  bookingErrorInvalidatesSelection,
  ClientApiError,
  createPublicBooking,
  newIdempotencyKey,
  publicErrorMessage,
  salonDateFromLocalDate,
  shouldRetainPublicIdempotencyKey,
  startMinutesFromTime,
} from "@/lib/client/publicApi.ts";
import {
  maintenanceStatusUnavailableMessage,
  publicMaintenanceMessage,
} from "@/lib/client/maintenanceApi.ts";
import { bookingContent } from "@/lib/content/bookingContent";
import {
  categoryContent,
  serviceName,
} from "@/components/services/serviceDiscoveryContent";
import { romeDate } from "@/lib/domain/booking/rome.ts";

// Components
const loadBookingCalendar = () => import("./ItalianBookingCalendar");
const loadPhoneInput = () => import("react-phone-input-2");
const loadBookingConfirmation = () => import("./BookingConfirmation");

const Calendar = dynamic(loadBookingCalendar, {
  ssr: false,
  loading: () => (
    <div
      aria-label="Caricamento calendario"
      className="h-[290px] w-[280px] animate-pulse rounded-md border bg-slate-50"
      role="status"
    />
  ),
});
const PhoneInput = dynamic(loadPhoneInput, {
  ssr: false,
  loading: () => (
    <div
      aria-label="Caricamento numero di telefono"
      className="h-10 w-full animate-pulse rounded-md border bg-slate-50"
      role="status"
    />
  ),
});
const BookingConfirmation = dynamic(loadBookingConfirmation, { ssr: false });

const BookAppointment = ({ locale = "it", showHeading = true }) => {
  const copy = bookingContent(locale);
  const { showError, notifyAsync } = usePublicBookingNotifications();
  const {
    publicBookingEnabled,
    messageCode: maintenanceMessageCode,
    unavailable: maintenanceStatusUnavailable,
  } = useMaintenanceStatus();
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [humanChallengeRequired, setHumanChallengeRequired] = useState(false);
  const [humanChallengeToken, setHumanChallengeToken] = useState(null);
  const [humanChallengeReset, setHumanChallengeReset] = useState(0);
  const [humanChallengeUnavailable, setHumanChallengeUnavailable] =
    useState(false);
  const bookingAttemptRef = useRef(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const handleHumanChallengeToken = useCallback((token) => {
    setHumanChallengeToken(token);
    if (token) setHumanChallengeUnavailable(false);
  }, []);
  const handleHumanChallengeUnavailable = useCallback(() => {
    setHumanChallengeToken(null);
    setHumanChallengeUnavailable(true);
  }, []);

  // Local state (must be declared before hooks that use them)
  const [appointmentType, setAppointmentType] = useState(() => {
    return SERVICE_CATALOG.services.find((service) => service.active) ?? null;
  });
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [showAllTimeSlots, setShowAllTimeSlots] = useState(false);
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [bookingData, setBookingData] = useState(null);

  // Custom hooks
  const { form, resetForm } = useBookingForm();

  const activeVariants = useMemo(() => {
    return appointmentType?.variants.filter((variant) => variant.active) ?? [];
  }, [appointmentType]);

  const currentVariant = useMemo(
    () =>
      activeVariants.find((variant) => variant.id === selectedVariantId) ??
      null,
    [activeVariants, selectedVariantId],
  );

  // Optimized time slots with real-time updates and caching
  const {
    timeSlots: availableTimeSlots,
    loading: timeSlotsLoading,
    error: timeSlotsError,
    refreshTimeSlots,
  } = useOptimizedTimeSlots(
    selectedDate,
    appointmentType?.id,
    currentVariant?.id,
    {
      enableRealTime: false, // DISABLED: Reduce Firebase reads during testing
      preloadDays: 0, // DISABLED: No background preloading
      bufferMinutes: 10, // Buffer time between appointments for salon setup/cleanup
    },
  );

  const initialVisibleSlots = 12;

  // Initialize appointment type in form
  useEffect(() => {
    if (appointmentType) {
      form.setValue("appointmentType", appointmentType.id);
      if (activeVariants.length === 1) {
        const onlyVariant = activeVariants[0];
        setSelectedVariantId(onlyVariant.id);
        form.setValue("variant", onlyVariant.id);
        form.setValue("duration", onlyVariant.serviceDurationMinutes);
      } else {
        setSelectedVariantId(null);
        form.setValue("variant", "");
        form.setValue("duration", 0);
      }
    }
  }, [activeVariants, appointmentType, form]);

  // Function to check if a day should be disabled
  const isDisabledDay = (day) => {
    const salonToday = romeDate(new Date());
    const maximumDate = new Date(`${salonToday}T12:00:00`);
    maximumDate.setDate(maximumDate.getDate() + 60);
    const salonDay = salonDateFromLocalDate(day);
    const salonMaximum = salonDateFromLocalDate(maximumDate);

    return (
      salonDay <= salonToday || salonDay > salonMaximum || !isBusinessDay(day)
    );
  };

  const clearSelectedTimeSlot = () => {
    setSelectedTimeSlot(null);
    setShowAllTimeSlots(false);
    form.setValue("timeSlot", "");
  };

  // Handle appointment type change by stable catalog ID.
  const handleAppointmentTypeChange = (e) => {
    clearSelectedTimeSlot();
    const selectedType = SERVICE_CATALOG.services.find(
      (service) => service.active && service.id === e.target.value,
    );
    if (selectedType) {
      setAppointmentType(selectedType);
      setSelectedVariantId(null);

      // Update form values
      form.setValue("appointmentType", selectedType.id);

      const variants = selectedType.variants.filter(
        (variant) => variant.active,
      );
      if (variants.length === 1) {
        const onlyVariant = variants[0];
        setSelectedVariantId(onlyVariant.id);
        form.setValue("variant", onlyVariant.id);
        form.setValue("duration", onlyVariant.serviceDurationMinutes);
      } else {
        form.setValue("variant", "");
        form.setValue("duration", 0);
      }
    } else {
      // Clear if nothing found (shouldn't happen with exact options)
      setAppointmentType(null);
      setSelectedVariantId(null);
      form.setValue("appointmentType", "");
      form.setValue("duration", 0);
      form.setValue("variant", "");
    }
  };

  // Handle duration/variant change
  const handleVariantChange = (e) => {
    clearSelectedTimeSlot();
    const variant = activeVariants.find(
      (candidate) => candidate.id === e.target.value,
    );
    setSelectedVariantId(variant?.id ?? null);
    form.setValue("duration", variant?.serviceDurationMinutes ?? 0);
    form.setValue("variant", variant?.id ?? "");
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
    void loadBookingConfirmation();
    setSelectedTimeSlot(timeSlot);
    form.setValue("timeSlot", timeSlot);
  };

  // Form submission handler
  const handleSubmit = async (data) => {
    if (!publicBookingEnabled) {
      showError(
        maintenanceStatusUnavailable
          ? maintenanceStatusUnavailableMessage(locale)
          : publicMaintenanceMessage(locale),
      );
      return;
    }
    if (humanChallengeRequired && !humanChallengeToken) {
      showError(copy.securityRequired);
      return;
    }
    setBookingLoading(true);
    try {
      const selection = catalogSelectionById(
        data.appointmentType,
        data.variant,
      );
      if (!selection) throw new Error("INVALID_CATALOG_SELECTION");

      const appointmentData = {
        name: data.name?.trim(),
        email: data.email?.trim().toLowerCase(),
        number: data.number,
        appointmentType: selection.service.nameIt,
        duration: selection.variant.serviceDurationMinutes,
        selectedDate: data.selectedDate,
        startTime: data.timeSlot,
        note: data.note?.trim() || "",
        variant: data.variant || "",
        status: "confirmed",
      };

      // Calculate end time
      const [hours, minutes] = String(data.timeSlot)
        .split(":")
        .map((n) => parseInt(n, 10));
      const totalMinutes =
        hours * 60 + minutes + selection.variant.serviceDurationMinutes;
      const endHours = Math.floor(totalMinutes / 60) % 24;
      const endMinutes = totalMinutes % 60;
      appointmentData.endTime = `${String(endHours).padStart(2, "0")}:${String(
        endMinutes,
      ).padStart(2, "0")}`;

      const command = {
        date: salonDateFromLocalDate(data.selectedDate),
        startMinutes: startMinutesFromTime(data.timeSlot),
        serviceId: selection.serviceId,
        variantId: selection.variantId,
        clientName: appointmentData.name,
        clientEmail: appointmentData.email,
        clientPhone: appointmentData.number,
        clientNote: appointmentData.note || null,
      };
      const fingerprint = JSON.stringify(command);
      if (bookingAttemptRef.current?.fingerprint !== fingerprint) {
        bookingAttemptRef.current = {
          fingerprint,
          idempotencyKey: newIdempotencyKey(),
        };
      }

      await notifyAsync(
        () =>
          createPublicBooking(
            command,
            bookingAttemptRef.current.idempotencyKey,
            humanChallengeToken || undefined,
          ),
        {
          loading: copy.bookingLoading,
          success: copy.bookingSuccess,
          error: (error) => publicErrorMessage(error, locale),
        },
      );
      bookingAttemptRef.current = null;
      setHumanChallengeRequired(false);
      setHumanChallengeToken(null);
      setHumanChallengeUnavailable(false);

      // Store booking data for confirmation modal
      setBookingData({
        ...appointmentData,
        formattedDate: formatDate(appointmentData.selectedDate),
        appointmentTypeDisplay: serviceName(selection.service, locale),
        durationDisplay: copy.minutes(appointmentData.duration),
      });

      // Reset form and open confirmation modal
      resetForm();
      form.setValue("appointmentType", selection.serviceId);
      form.setValue("variant", selection.variantId);
      form.setValue("duration", selection.variant.serviceDurationMinutes);
      setSelectedTimeSlot(null);
      setModalIsOpen(true);
    } catch (error) {
      if (
        error instanceof ClientApiError &&
        error.code === "HUMAN_VERIFICATION_REQUIRED"
      ) {
        setHumanChallengeRequired(true);
      }
      if (humanChallengeToken) {
        setHumanChallengeToken(null);
        setHumanChallengeReset((value) => value + 1);
      }
      if (
        error instanceof Error &&
        error.message === "INVALID_CATALOG_SELECTION"
      ) {
        showError(copy.invalidCatalog);
      } else {
        if (!shouldRetainPublicIdempotencyKey(error)) {
          bookingAttemptRef.current = null;
        }
      }
      if (bookingErrorInvalidatesSelection(error)) {
        setSelectedTimeSlot(null);
        form.setValue("timeSlot", "");
        refreshTimeSlots();
      }
    } finally {
      setBookingLoading(false);
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
      const missingFields = [];
      if (errors.name) missingFields.push(copy.missingFields.name);
      if (errors.email) missingFields.push(copy.missingFields.email);
      if (errors.number) missingFields.push(copy.missingFields.number);
      if (errors.timeSlot) missingFields.push(copy.missingFields.timeSlot);
      if (errors.selectedDate || errors.date)
        missingFields.push(copy.missingFields.date);
      if (errors.appointmentType)
        missingFields.push(copy.missingFields.appointmentType);
      if (errors.duration) missingFields.push(copy.missingFields.duration);

      // Show error notification
      showError(`${copy.missingPrefix} ${missingFields.join(", ")}`, {
        duration: 6000,
      });

      // Scroll to first error field
      const firstErrorField = Object.keys(errors)[0];
      const firstErrorElement = document.querySelector(
        `[name="${firstErrorField}"]`,
      );
      if (firstErrorElement) {
        firstErrorElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        firstErrorElement.focus();
      }
    },
  );

  const closeModal = () => setModalIsOpen(false);

  return (
    <div
      className={`m-auto w-[90vw] space-y-4 md:w-[70vw] ${showHeading ? "mt-12" : "mt-0"}`}
    >
      {/* Header */}
      {showHeading ? (
        <div className="flex flex-col gap-2 py-1 md:gap-4 md:py-4">
          <h4 className="text-xs font-extrabold text-primary">
            {copy.eyebrow}
          </h4>
          <h2 className="font-serif text-3xl font-bold tracking-tight md:text-3xl">
            {copy.heading}
          </h2>
        </div>
      ) : null}

      {maintenanceMessageCode === "MAINTENANCE_ACTIVE" ||
      maintenanceMessageCode === "OWNER_RECONCILIATION_ACTIVE" ||
      maintenanceStatusUnavailable ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
          {maintenanceStatusUnavailable
            ? maintenanceStatusUnavailableMessage(locale)
            : publicMaintenanceMessage(locale)}
        </div>
      ) : null}

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
                  <FormLabel>{copy.selectDate}</FormLabel>
                  <FormControl>
                    <Calendar
                      locale={locale}
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
                    {copy.selectTime}
                  </FormLabel>
                  <FormControl>
                    <div className="space-y-4">
                      {timeSlotsLoading ? (
                        <div className="flex h-32 items-center justify-center rounded-lg border">
                          <div className="text-muted-foreground">
                            {copy.loadingTimes}
                          </div>
                        </div>
                      ) : timeSlotsError ? (
                        <div className="flex h-32 flex-col items-center justify-center gap-3 rounded-lg border px-4 text-center">
                          <div className="text-muted-foreground">
                            {publicErrorMessage(timeSlotsError, locale)}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={refreshTimeSlots}
                          >
                            {copy.retry}
                          </Button>
                        </div>
                      ) : !availableTimeSlots ||
                        availableTimeSlots.length === 0 ? (
                        <div className="flex h-32 items-center justify-center rounded-lg border">
                          <div className="text-muted-foreground">
                            {copy.noTimes}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-2 rounded-lg border p-5">
                            {(showAllTimeSlots
                              ? availableTimeSlots || []
                              : (availableTimeSlots || []).slice(
                                  0,
                                  initialVisibleSlots,
                                )
                            ).map((timeSlot, index) => (
                              <Button
                                key={index}
                                type="button"
                                variant={
                                  timeSlot === selectedTimeSlot
                                    ? "default"
                                    : "outline-solid"
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
                                ? copy.showLess
                                : copy.showMore(
                                    (availableTimeSlots?.length || 0) -
                                      initialVisibleSlots,
                                  )}
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
                  <FormLabel>{copy.treatment}</FormLabel>
                  <FormControl>
                    <select
                      className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                        fieldState.error
                          ? "border-red-500 focus:border-red-500"
                          : "border-input"
                      }`}
                      {...field}
                      onChange={handleAppointmentTypeChange}
                      value={appointmentType?.id || field.value || ""}
                    >
                      <option value="">{copy.selectTreatment}</option>
                      {SERVICE_CATALOG.categories
                        .filter((category) => category.active)
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((category) => {
                          const categoryServices = SERVICE_CATALOG.services
                            .filter(
                              (service) =>
                                service.active &&
                                service.categoryId === category.id,
                            )
                            .sort((a, b) =>
                              serviceName(a, locale).localeCompare(
                                serviceName(b, locale),
                                locale,
                              ),
                            );
                          if (categoryServices.length === 0) return null;
                          return (
                            <optgroup
                              key={category.id}
                              label={
                                categoryContent(category.id, locale)?.title ??
                                category.nameIt
                              }
                            >
                              {categoryServices.map((service) => (
                                <option key={service.id} value={service.id}>
                                  {serviceName(service, locale)}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Duration/Variant Selection */}
            {appointmentType && activeVariants.length > 0 && (
              <FormField
                control={form.control}
                name="variant"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>
                      {copy.duration}
                      {activeVariants.length > 1 &&
                        copy.optionCount(activeVariants.length)}
                    </FormLabel>
                    <FormControl>
                      {activeVariants.length === 1 ? (
                        // If only one duration is available, show a disabled text input
                        <>
                          {/* Keep the actual form value in a hidden input so react-hook-form has the value */}
                          <input
                            type="hidden"
                            {...field}
                            value={activeVariants[0].id}
                          />
                          <Input
                            value={copy.minutes(
                              activeVariants[0].serviceDurationMinutes,
                            )}
                            disabled
                          />
                        </>
                      ) : (
                        <select
                          className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                            fieldState.error
                              ? "border-red-500 focus:border-red-500"
                              : "border-input"
                          }`}
                          {...field}
                          onChange={handleVariantChange}
                          value={selectedVariantId ?? ""}
                        >
                          <option value="">{copy.selectDuration}</option>
                          {activeVariants.map((variant) => (
                            <option key={variant.id} value={variant.id}>
                              {copy.minutes(variant.serviceDurationMinutes)}
                            </option>
                          ))}
                        </select>
                      )}
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
                  <FormLabel>{copy.note}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder={copy.notePlaceholder}
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
                  <FormLabel>{copy.name}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder={copy.namePlaceholder}
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
                  <FormLabel>{copy.email}</FormLabel>
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
                  <FormLabel>{copy.phone}</FormLabel>
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
                      containerStyle={{ marginTop: "0.5rem" }}
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

          {humanChallengeRequired ? (
            <div className="mt-6 space-y-2">
              <p
                id="booking-security-verification"
                className="text-center text-sm text-muted-foreground"
                role="status"
              >
                {copy.securityRequired}
              </p>
              {humanChallengeUnavailable ? (
                <p
                  className="text-center text-sm text-destructive"
                  role="alert"
                >
                  {copy.securityUnavailable}
                </p>
              ) : null}
              <TurnstileChallenge
                action="public_booking"
                onToken={handleHumanChallengeToken}
                onUnavailable={handleHumanChallengeUnavailable}
                resetSignal={humanChallengeReset}
                siteKey={turnstileSiteKey}
              />
            </div>
          ) : null}

          {/* Submit Button */}
          <div className="mt-8 flex justify-center">
            <Button
              type="submit"
              className="w-full md:w-auto px-8 py-3"
              aria-describedby={
                humanChallengeRequired
                  ? "booking-security-verification"
                  : undefined
              }
              disabled={
                bookingLoading ||
                !selectedDate ||
                !selectedTimeSlot ||
                timeSlotsLoading ||
                Boolean(timeSlotsError) ||
                !publicBookingEnabled ||
                !currentVariant ||
                (humanChallengeRequired && !humanChallengeToken)
              }
            >
              {bookingLoading ? copy.bookingLoading : copy.submit}
            </Button>
          </div>

          {/* Helper text for required fields */}
          <div className="mt-4 text-center">
            <p className="text-sm text-muted-foreground">{copy.required}</p>
          </div>
        </form>
      </Form>

      {/* Booking Confirmation Modal */}
      {modalIsOpen && bookingData && (
        <BookingConfirmation
          isOpen={modalIsOpen}
          locale={locale}
          onRequestClose={closeModal}
          bookingData={bookingData}
        />
      )}
    </div>
  );
};

export default BookAppointment;
