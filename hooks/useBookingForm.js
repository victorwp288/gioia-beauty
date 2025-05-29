import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { addDoc, collection, runTransaction, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { toast } from "react-toastify";

// Form validation schema
const formSchema = z.object({
  date: z.date(),
  note: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  number: z.string().min(1, "Phone number is required"),
  email: z.string().email("Invalid email address"),
  timeSlot: z.string().min(1, "Time slot is required"),
  selectedDate: z
    .date()
    .min(
      new Date(new Date().setHours(0, 0, 0, 0) + 86400000),
      "Cannot book today or past dates"
    ),
  appointmentType: z.string().min(1, "Appointment type is required"),
  variant: z.string().optional(),
  duration: z.number().min(1, "Duration is required"),
});

export const useBookingForm = (
  appointmentTypes = [],
  onBookingSuccess = null
) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      date: null,
      note: "",
      name: "",
      number: "",
      email: "",
      timeSlot: "",
      selectedDate: null,
      appointmentType: appointmentTypes[0]?.type || "",
      variant: "",
      duration: appointmentTypes[0]?.durations[0] || 0,
    },
  });

  // Calculate end time based on start time and duration
  const calculateEndTime = useCallback(
    (startTime, durationMinutes, extraTime = 0) => {
      if (!startTime || !durationMinutes) return "";

      const [hours, minutes] = startTime.split(":").map(Number);
      const totalMinutes =
        hours * 60 + minutes + Number(durationMinutes) + Number(extraTime);
      const endHours = Math.floor(totalMinutes / 60) % 24;
      const endMinutes = totalMinutes % 60;

      return `${String(endHours).padStart(2, "0")}:${String(
        endMinutes
      ).padStart(2, "0")}`;
    },
    []
  );

  // Get selected appointment type details
  const getSelectedAppointmentType = useCallback(() => {
    const selectedType = form.getValues("appointmentType");
    return appointmentTypes.find((type) => type.type === selectedType);
  }, [appointmentTypes, form]);

  // Update appointment type and reset dependent fields
  const updateAppointmentType = useCallback(
    (newType) => {
      const selectedType = appointmentTypes.find(
        (type) => type.type === newType
      );
      if (selectedType) {
        form.setValue("appointmentType", newType);
        form.setValue("variant", "");
        form.setValue("duration", selectedType.durations[0]);

        // Clear time slot selection as duration changed
        form.setValue("timeSlot", "");
      }
    },
    [appointmentTypes, form]
  );

  // Update variant and duration
  const updateVariant = useCallback(
    (variantIndex) => {
      const selectedType = getSelectedAppointmentType();
      if (
        selectedType &&
        variantIndex >= 0 &&
        variantIndex < selectedType.variants?.length
      ) {
        form.setValue("variant", selectedType.variants[variantIndex]);
        form.setValue("duration", selectedType.durations[variantIndex]);

        // Clear time slot selection as duration changed
        form.setValue("timeSlot", "");
      }
    },
    [getSelectedAppointmentType, form]
  );

  // Validate booking data before submission
  const validateBookingData = useCallback(
    (data) => {
      const selectedType = getSelectedAppointmentType();
      if (!selectedType) {
        throw new Error("Please select a valid appointment type.");
      }

      if (!data.timeSlot) {
        throw new Error("Please select a time slot.");
      }

      if (!data.selectedDate) {
        throw new Error("Please select a date.");
      }

      return true;
    },
    [getSelectedAppointmentType]
  );

  // Submit booking form
  const submitBooking = useCallback(
    async (data) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Validate the booking data
        validateBookingData(data);

        const selectedType = getSelectedAppointmentType();
        const extraTime = selectedType.extraTime?.[0] || 0;

        const endTime = calculateEndTime(
          data.timeSlot,
          data.duration,
          extraTime
        );

        const appointmentData = {
          name: data.name,
          email: data.email,
          number: data.number,
          appointmentType: data.appointmentType,
          variant: data.variant || "",
          startTime: data.timeSlot,
          endTime: endTime,
          duration: data.duration,
          totalDuration: data.duration + extraTime,
          selectedDate: data.selectedDate.toISOString(),
          note: data.note || "",
          createdAt: new Date().toISOString(),
          status: "confirmed",
        };

        // Use transaction to ensure data consistency
        await runTransaction(db, async (transaction) => {
          const appointmentRef = doc(collection(db, "customers"));
          transaction.set(appointmentRef, appointmentData);
        });

        // Send confirmation emails
        try {
          const emailResponse = await fetch("/api/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email: data.email,
              name: data.name,
              startTime: data.timeSlot,
              endTime: endTime,
              duration: data.duration,
              date: data.selectedDate.toLocaleDateString("it-IT"),
              appointmentType: data.appointmentType,
            }),
          });

          if (!emailResponse.ok) {
            console.warn("Failed to send confirmation email");
          }
        } catch (emailError) {
          console.warn("Email sending failed:", emailError);
          // Don't fail the booking if email fails
        }

        toast.success("Appointment booked successfully!");

        // Call success callback if provided
        if (onBookingSuccess) {
          onBookingSuccess(appointmentData);
        }

        return appointmentData;
      } catch (error) {
        setSubmitError(error.message);
        console.error("Error submitting booking:", error);
        toast.error(
          error.message || "Failed to book appointment. Please try again."
        );
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      validateBookingData,
      getSelectedAppointmentType,
      calculateEndTime,
      onBookingSuccess,
    ]
  );

  // Reset form to initial state
  const resetForm = useCallback(() => {
    form.reset();
    setSubmitError(null);

    // Reset to first appointment type if available
    if (appointmentTypes.length > 0) {
      form.setValue("appointmentType", appointmentTypes[0].type);
      form.setValue("duration", appointmentTypes[0].durations[0]);
    }
  }, [form, appointmentTypes]);

  // Set form date and related fields
  const setFormDate = useCallback(
    (date) => {
      form.setValue("date", date);
      form.setValue("selectedDate", date);
      // Clear time slot when date changes
      form.setValue("timeSlot", "");
    },
    [form]
  );

  // Set time slot
  const setTimeSlot = useCallback(
    (timeSlot) => {
      form.setValue("timeSlot", timeSlot);
    },
    [form]
  );

  // Get current form values
  const getFormValues = useCallback(() => {
    return form.getValues();
  }, [form]);

  // Check if form is valid
  const isFormValid = useCallback(() => {
    const values = form.getValues();
    return (
      form.formState.isValid &&
      values.name &&
      values.email &&
      values.number &&
      values.timeSlot &&
      values.selectedDate &&
      values.appointmentType
    );
  }, [form]);

  return {
    form,
    isSubmitting,
    submitError,
    submitBooking,
    resetForm,
    updateAppointmentType,
    updateVariant,
    setFormDate,
    setTimeSlot,
    getFormValues,
    getSelectedAppointmentType,
    calculateEndTime,
    isFormValid,
    formState: form.formState,
    watch: form.watch,
    setValue: form.setValue,
    getValues: form.getValues,
  };
};
