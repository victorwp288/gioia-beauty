"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getOwnerSchedule,
  getOwnerVacations,
  runOwnerCommand,
} from "@/lib/client/ownerApi.ts";
import {
  catalogSelection,
  salonDateFromLocalDate,
  startMinutesFromTime,
  timeFromStartMinutes,
} from "@/lib/client/publicApi.ts";
import { formatDateString } from "@/lib/utils/dateUtils";

const AppointmentContext = createContext(null);
const VISIBLE_STATUSES = ["confirmed", "completed", "no_show", "active"];

function endTime(startMinutes, durationMinutes, bufferMinutes) {
  const total = startMinutes + durationMinutes + bufferMinutes;
  if (total === 1_440) return "24:00";
  return timeFromStartMinutes(total);
}

function scheduleEntryToLegacy(entry) {
  const shared = {
    id: entry.id,
    date: entry.date,
    selectedDate: entry.date,
    startTime: timeFromStartMinutes(entry.startMinutes),
    endTime: endTime(
      entry.startMinutes,
      entry.serviceDurationMinutes,
      entry.bufferMinutes,
    ),
    duration: entry.serviceDurationMinutes,
    totalDuration: entry.serviceDurationMinutes + entry.bufferMinutes,
    status: entry.status,
    version: entry.version,
    kind: entry.kind,
    source: entry.source,
    _canonical: entry,
  };
  if (entry.kind === "block") {
    return {
      ...shared,
      name: "Blocco Orario",
      email: "",
      number: "",
      appointmentType: "Blocco Orario",
      note: entry.internalNote ?? "",
      internalNote: entry.internalNote ?? "",
      isTimeBlock: true,
    };
  }
  return {
    ...shared,
    name: entry.clientName,
    email: entry.clientEmail ?? "",
    number: entry.clientPhone ?? "",
    appointmentType: entry.serviceNameSnapshot,
    variant: entry.variantNameSnapshot,
    note: entry.clientNote ?? "",
    internalNote: entry.internalNote ?? "",
    serviceId: entry.serviceId,
    variantId: entry.variantId,
    isTimeBlock: false,
  };
}

function defaultScheduleRange() {
  const today = new Date();
  return {
    fromDate: salonDateFromLocalDate(
      new Date(today.getFullYear(), today.getMonth(), 1),
    ),
    toDate: salonDateFromLocalDate(
      new Date(today.getFullYear(), today.getMonth() + 1, 0),
    ),
  };
}

function rangeFromOptions(options = {}) {
  if (!options.dateRange) return defaultScheduleRange();
  const fromDate = formatDateString(options.dateRange.start);
  const toDate = formatDateString(options.dateRange.end);
  if (!fromDate || !toDate) throw new TypeError("Invalid schedule range");
  return { fromDate, toDate };
}

function vacationRange() {
  const now = new Date();
  const horizon = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 365,
  );
  return {
    fromDate: salonDateFromLocalDate(now),
    toDate: salonDateFromLocalDate(horizon),
  };
}

export const useAppointmentContext = () => {
  const context = useContext(AppointmentContext);
  if (!context) {
    throw new Error(
      "useAppointmentContext must be used within an AppointmentProvider",
    );
  }
  return context;
};

export const AppointmentProvider = ({ children }) => {
  const [appointments, setAppointments] = useState([]);
  const [vacationPeriods, setVacationPeriods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [vacationsLoading, setVacationsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vacationsError, setVacationsError] = useState(null);
  const lastRangeRef = useRef(defaultScheduleRange());

  const fetchAppointments = useCallback(async (options = {}) => {
    const range = rangeFromOptions(options);
    lastRangeRef.current = range;
    setLoading(true);
    setError(null);
    try {
      const entries = [];
      let cursor;
      for (let page = 0; page < 5; page += 1) {
        const result = await getOwnerSchedule({
          ...range,
          statuses: VISIBLE_STATUSES,
          pageSize: 100,
          cursor,
        });
        entries.push(...result.items);
        cursor = result.nextCursor ?? undefined;
        if (!cursor) break;
      }
      if (cursor) throw new Error("SCHEDULE_PAGE_LIMIT_REACHED");
      const mapped = entries.map(scheduleEntryToLegacy);
      setAppointments(mapped);
      return {
        appointments: mapped,
        total: mapped.length,
        nextCursor: null,
      };
    } catch (cause) {
      setError(cause);
      throw cause;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAppointments = useCallback(
    () =>
      fetchAppointments({
        dateRange: {
          start: lastRangeRef.current.fromDate,
          end: lastRangeRef.current.toDate,
        },
      }),
    [fetchAppointments],
  );

  const createAppointment = useCallback(
    async (input) => {
      const date = formatDateString(input.selectedDate ?? input.date);
      const startMinutes = startMinutesFromTime(input.startTime);
      if (input.isTimeBlock || input.appointmentType === "Blocco Orario") {
        await runOwnerCommand("/api/admin/blocks", {
          date,
          startMinutes,
          durationMinutes: Number(input.duration),
          bufferMinutes: 0,
          internalNote: input.note?.trim() || null,
        });
      } else {
        const selection = catalogSelection(
          input.appointmentType,
          Number(input.duration),
        );
        if (!selection) throw new TypeError("Invalid catalog selection");
        await runOwnerCommand("/api/admin/appointments", {
          date,
          startMinutes,
          serviceId: selection.serviceId,
          variantId: selection.variantId,
          clientName: input.name?.trim(),
          clientEmail: input.email?.trim().toLowerCase() || null,
          clientPhone: input.number?.trim() || null,
          clientNote: input.note?.trim() || null,
        });
      }
      await refreshAppointments();
    },
    [refreshAppointments],
  );

  const updateAppointment = useCallback(
    async (appointmentId, input) => {
      const current = appointments.find((item) => item.id === appointmentId);
      if (!current) throw new TypeError("Appointment is not loaded");
      const date = formatDateString(input.selectedDate ?? input.date);
      const startMinutes = startMinutesFromTime(input.startTime);
      let version = current.version;

      try {
        if (current.kind === "block") {
          const scheduleChanged =
            date !== current.date ||
            startMinutes !== current._canonical.startMinutes ||
            Number(input.duration) !== current.duration;
          if (scheduleChanged) {
            await runOwnerCommand("/api/admin/blocks/reschedule", {
              entryId: appointmentId,
              expectedVersion: version,
              date,
              startMinutes,
              durationMinutes: Number(input.duration),
              bufferMinutes: 0,
            });
            version += 1;
          }
          if ((input.note?.trim() || null) !== (current.note || null)) {
            await runOwnerCommand("/api/admin/blocks/details", {
              entryId: appointmentId,
              expectedVersion: version,
              internalNote: input.note?.trim() || null,
            });
          }
        } else {
          const selection = catalogSelection(
            input.appointmentType,
            Number(input.duration),
          );
          if (!selection) throw new TypeError("Invalid catalog selection");
          const scheduleChanged =
            date !== current.date ||
            startMinutes !== current._canonical.startMinutes ||
            selection.serviceId !== current.serviceId ||
            selection.variantId !== current.variantId;
          if (scheduleChanged) {
            await runOwnerCommand("/api/admin/appointments/reschedule", {
              entryId: appointmentId,
              expectedVersion: version,
              date,
              startMinutes,
              serviceId: selection.serviceId,
              variantId: selection.variantId,
            });
            version += 1;
          }
          const detailsChanged =
            input.name?.trim() !== current.name ||
            (input.email?.trim().toLowerCase() || "") !== current.email ||
            (input.number?.trim() || "") !== current.number ||
            (input.note?.trim() || "") !== current.note;
          if (detailsChanged) {
            await runOwnerCommand("/api/admin/appointments/details", {
              entryId: appointmentId,
              expectedVersion: version,
              clientName: input.name?.trim(),
              clientEmail: input.email?.trim().toLowerCase() || null,
              clientPhone: input.number?.trim() || null,
              clientNote: input.note?.trim() || null,
            });
          }
        }
      } catch (cause) {
        await refreshAppointments().catch(() => undefined);
        throw cause;
      }
      await refreshAppointments();
    },
    [appointments, refreshAppointments],
  );

  const deleteAppointment = useCallback(
    async (appointmentId) => {
      const current = appointments.find((item) => item.id === appointmentId);
      if (!current) throw new TypeError("Appointment is not loaded");
      await runOwnerCommand("/api/admin/schedule/cancel", {
        entryId: appointmentId,
        expectedVersion: current.version,
        reason: null,
      });
      await refreshAppointments();
    },
    [appointments, refreshAppointments],
  );

  const fetchVacations = useCallback(async () => {
    setVacationsLoading(true);
    setVacationsError(null);
    try {
      const items = [];
      let cursor;
      for (let page = 0; page < 5; page += 1) {
        const result = await getOwnerVacations({
          ...vacationRange(),
          cursor,
        });
        items.push(...result.items);
        cursor = result.nextCursor ?? undefined;
        if (!cursor) break;
      }
      if (cursor) throw new Error("VACATION_PAGE_LIMIT_REACHED");
      const active = items.filter((item) => item.status === "active");
      setVacationPeriods(active);
      return active;
    } catch (cause) {
      setVacationsError(cause);
      throw cause;
    } finally {
      setVacationsLoading(false);
    }
  }, []);

  const createVacationPeriod = useCallback(
    async (startDate, endDate, reason) => {
      await runOwnerCommand("/api/admin/vacations", {
        startDate: formatDateString(startDate),
        endDate: formatDateString(endDate),
        reason: reason?.trim() || null,
      });
      await fetchVacations();
    },
    [fetchVacations],
  );

  const updateVacationPeriod = useCallback(
    async (vacationId, startDate, endDate, reason) => {
      const current = vacationPeriods.find((item) => item.id === vacationId);
      if (!current) throw new TypeError("Vacation is not loaded");
      await runOwnerCommand("/api/admin/vacations/update", {
        vacationId,
        expectedVersion: current.version,
        startDate: formatDateString(startDate),
        endDate: formatDateString(endDate),
        reason: reason?.trim() || null,
      });
      await fetchVacations();
    },
    [fetchVacations, vacationPeriods],
  );

  const deleteVacationPeriod = useCallback(
    async (vacationId) => {
      const current = vacationPeriods.find((item) => item.id === vacationId);
      if (!current) throw new TypeError("Vacation is not loaded");
      await runOwnerCommand("/api/admin/vacations/cancel", {
        vacationId,
        expectedVersion: current.version,
      });
      await fetchVacations();
    },
    [fetchVacations, vacationPeriods],
  );

  useEffect(() => {
    void Promise.allSettled([fetchAppointments(), fetchVacations()]);
  }, [fetchAppointments, fetchVacations]);

  const value = useMemo(
    () => ({
      appointments,
      loading,
      error,
      vacationPeriods,
      vacationsLoading,
      vacationsError,
      fetchAppointments,
      createAppointment,
      updateAppointment,
      deleteAppointment,
      fetchVacations,
      createVacationPeriod,
      updateVacationPeriod,
      deleteVacationPeriod,
    }),
    [
      appointments,
      createAppointment,
      createVacationPeriod,
      deleteAppointment,
      deleteVacationPeriod,
      error,
      fetchAppointments,
      fetchVacations,
      loading,
      refreshAppointments,
      updateAppointment,
      updateVacationPeriod,
      vacationPeriods,
      vacationsError,
      vacationsLoading,
    ],
  );

  return (
    <AppointmentContext.Provider value={value}>
      {children}
    </AppointmentContext.Provider>
  );
};

export default AppointmentProvider;
