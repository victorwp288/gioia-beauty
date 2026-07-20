import { useCallback, useEffect, useMemo, useState } from "react";

import {
  catalogSelection,
  getPublicAvailability,
  salonDateFromLocalDate,
  timeFromStartMinutes,
} from "@/lib/client/publicApi.ts";
import {
  getBusinessHoursForDay,
  isDateAvailableForBooking,
} from "@/lib/utils/timeUtils";

export const useOptimizedTimeSlots = (
  selectedDate,
  appointmentType,
  duration,
  _options = {},
) => {
  const [timeSlots, setTimeSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const businessHours = useMemo(() => {
    if (!selectedDate) return null;
    return getBusinessHoursForDay(selectedDate.getDay());
  }, [selectedDate]);
  const isDateAvailable = useMemo(() => {
    if (!selectedDate || !businessHours) return false;
    return isDateAvailableForBooking(selectedDate);
  }, [selectedDate, businessHours]);
  const selection = useMemo(
    () => catalogSelection(appointmentType, Number(duration)),
    [appointmentType, duration],
  );

  const getTimeSlotsForDate = useCallback(
    async (date, signal) => {
      if (!date || !selection || !isDateAvailableForBooking(date)) return [];
      const result = await getPublicAvailability(
        {
          date: salonDateFromLocalDate(date),
          serviceId: selection.serviceId,
          variantId: selection.variantId,
        },
        signal,
      );
      return result.slots.map(timeFromStartMinutes);
    },
    [selection],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (!selectedDate || !selection || !isDateAvailable) {
      setTimeSlots([]);
      setLoading(false);
      setError(null);
      return () => controller.abort();
    }
    setLoading(true);
    setError(null);
    getTimeSlotsForDate(selectedDate, controller.signal)
      .then((slots) => {
        if (!controller.signal.aborted) setTimeSlots(slots);
      })
      .catch((cause) => {
        if (cause?.name === "AbortError") return;
        setTimeSlots([]);
        setError(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    getTimeSlotsForDate,
    isDateAvailable,
    refreshVersion,
    selectedDate,
    selection,
  ]);

  const refreshTimeSlots = useCallback(() => {
    setRefreshVersion((value) => value + 1);
  }, []);

  return {
    timeSlots,
    loading,
    error,
    refreshTimeSlots,
    getTimeSlotsForDate,
    isDateAvailable,
    businessHours,
  };
};
