import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { emailSchema } from "@/lib/utils/validationSchemas";

const formSchema = z.object({
  date: z.date(),
  note: z.string().optional(),
  name: z.string().trim().min(1, "Name is required"),
  number: z.string().trim().min(1, "Phone number is required"),
  email: emailSchema,
  timeSlot: z.string().min(1, "Time slot is required"),
  selectedDate: z.date(),
  appointmentType: z.string().min(1, "Appointment type is required"),
  variant: z.string().optional(),
  duration: z.number().min(1, "Duration is required"),
});

export const useBookingForm = () => {
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
      appointmentType: "",
      variant: "",
      duration: 0,
    },
  });

  const resetForm = useCallback(() => {
    form.reset();
  }, [form]);

  return { form, resetForm };
};
