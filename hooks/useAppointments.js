import { useState, useEffect, useCallback } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { toast } from "react-toastify";

export const useAppointments = (dateFilter = null) => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch appointments with optional date filtering
  const fetchAppointments = useCallback(
    async (specificDate = null) => {
      setLoading(true);
      setError(null);

      try {
        let appointmentsQuery = collection(db, "customers");

        // Add date filtering if provided
        if (specificDate || dateFilter) {
          const filterDate = specificDate || dateFilter;
          const startOfDay = new Date(filterDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(filterDate);
          endOfDay.setHours(23, 59, 59, 999);

          appointmentsQuery = query(
            collection(db, "customers"),
            where("selectedDate", ">=", startOfDay.toISOString()),
            where("selectedDate", "<=", endOfDay.toISOString()),
            orderBy("selectedDate"),
            orderBy("startTime")
          );
        } else {
          appointmentsQuery = query(
            collection(db, "customers"),
            orderBy("selectedDate"),
            orderBy("startTime")
          );
        }

        const querySnapshot = await getDocs(appointmentsQuery);
        const appointmentsData = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setAppointments(appointmentsData);
        return appointmentsData;
      } catch (err) {
        setError(err.message);
        console.error("Error fetching appointments:", err);
        toast.error("Failed to fetch appointments. Please try again.");
        return [];
      } finally {
        setLoading(false);
      }
    },
    [dateFilter]
  );

  // Create new appointment
  const createAppointment = useCallback(async (appointmentData) => {
    setLoading(true);
    setError(null);

    try {
      const docRef = await addDoc(collection(db, "customers"), {
        ...appointmentData,
        createdAt: new Date().toISOString(),
      });

      const newAppointment = {
        id: docRef.id,
        ...appointmentData,
        createdAt: new Date().toISOString(),
      };

      // Optimistic update
      setAppointments((prev) => [...prev, newAppointment]);

      toast.success("Appointment created successfully");
      return newAppointment;
    } catch (err) {
      setError(err.message);
      console.error("Error creating appointment:", err);
      toast.error("Failed to create appointment. Please try again.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Update existing appointment
  const updateAppointment = useCallback(async (appointmentId, updatedData) => {
    setLoading(true);
    setError(null);

    try {
      await updateDoc(doc(db, "customers", appointmentId), {
        ...updatedData,
        updatedAt: new Date().toISOString(),
      });

      // Optimistic update
      setAppointments((prev) =>
        prev.map((appointment) =>
          appointment.id === appointmentId
            ? {
                ...appointment,
                ...updatedData,
                updatedAt: new Date().toISOString(),
              }
            : appointment
        )
      );

      toast.success("Appointment updated successfully");
      return { id: appointmentId, ...updatedData };
    } catch (err) {
      setError(err.message);
      console.error("Error updating appointment:", err);
      toast.error("Failed to update appointment. Please try again.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Delete appointment
  const deleteAppointment = useCallback(async (appointmentId) => {
    setLoading(true);
    setError(null);

    try {
      await deleteDoc(doc(db, "customers", appointmentId));

      // Optimistic update
      setAppointments((prev) =>
        prev.filter((appointment) => appointment.id !== appointmentId)
      );

      toast.success("Appointment deleted successfully");
      return true;
    } catch (err) {
      setError(err.message);
      console.error("Error deleting appointment:", err);
      toast.error("Failed to delete appointment. Please try again.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Get appointments for a specific date
  const getAppointmentsByDate = useCallback(
    (date) => {
      return appointments.filter((appointment) => {
        const appointmentDate = new Date(appointment.selectedDate);
        return appointmentDate.toDateString() === date.toDateString();
      });
    },
    [appointments]
  );

  // Initial fetch on mount
  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  return {
    appointments,
    loading,
    error,
    fetchAppointments,
    createAppointment,
    updateAppointment,
    deleteAppointment,
    getAppointmentsByDate,
    refetch: fetchAppointments,
  };
};
