import { useState, useEffect, useCallback } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { toast } from "react-toastify";

export const useVacations = () => {
  const [vacations, setVacations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch all vacation periods
  const fetchVacations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const querySnapshot = await getDocs(collection(db, "vacations"));
      const vacationsData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Convert date strings to Date objects and sort by start date
      const formattedVacations = vacationsData
        .map((vacation) => ({
          ...vacation,
          startDate: new Date(vacation.startDate),
          endDate: new Date(vacation.endDate),
        }))
        .sort((a, b) => a.startDate - b.startDate);

      setVacations(formattedVacations);
      return formattedVacations;
    } catch (err) {
      setError(err.message);
      console.error("Error fetching vacations:", err);
      toast.error("Failed to fetch vacation periods. Please try again.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a new vacation period
  const createVacation = useCallback(
    async (startDate, endDate, reason = "") => {
      // Validation
      if (!startDate || !endDate) {
        toast.error("Please select both start and end dates.");
        return false;
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (end < start) {
        toast.error("End date must be after start date.");
        return false;
      }

      // Check for overlaps with existing vacations
      const hasOverlap = vacations.some((vacation) => {
        return (
          (start >= vacation.startDate && start <= vacation.endDate) ||
          (end >= vacation.startDate && end <= vacation.endDate) ||
          (start <= vacation.startDate && end >= vacation.endDate)
        );
      });

      if (hasOverlap) {
        toast.error("This vacation period overlaps with an existing one.");
        return false;
      }

      setLoading(true);
      setError(null);

      try {
        const vacationData = {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          reason,
          createdAt: new Date().toISOString(),
        };

        const docRef = await addDoc(collection(db, "vacations"), vacationData);

        const newVacation = {
          id: docRef.id,
          startDate: start,
          endDate: end,
          reason,
          createdAt: new Date().toISOString(),
        };

        // Optimistic update
        setVacations((prev) =>
          [...prev, newVacation].sort((a, b) => a.startDate - b.startDate)
        );

        toast.success("Vacation period added successfully");
        return newVacation;
      } catch (err) {
        setError(err.message);
        console.error("Error creating vacation:", err);
        toast.error("Failed to add vacation period. Please try again.");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [vacations]
  );

  // Delete a vacation period
  const deleteVacation = useCallback(async (vacationId) => {
    setLoading(true);
    setError(null);

    try {
      await deleteDoc(doc(db, "vacations", vacationId));

      // Optimistic update
      setVacations((prev) =>
        prev.filter((vacation) => vacation.id !== vacationId)
      );

      toast.success("Vacation period deleted successfully");
      return true;
    } catch (err) {
      setError(err.message);
      console.error("Error deleting vacation:", err);
      toast.error("Failed to delete vacation period. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Check if a specific date is during a vacation period
  const isDateInVacation = useCallback(
    (date) => {
      const checkDate = new Date(date);
      checkDate.setHours(0, 0, 0, 0);

      return vacations.some((vacation) => {
        const vacationStart = new Date(vacation.startDate);
        vacationStart.setHours(0, 0, 0, 0);
        const vacationEnd = new Date(vacation.endDate);
        vacationEnd.setHours(23, 59, 59, 999);

        return checkDate >= vacationStart && checkDate <= vacationEnd;
      });
    },
    [vacations]
  );

  // Get vacation periods that overlap with a date range
  const getVacationsInRange = useCallback(
    (startDate, endDate) => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      return vacations.filter((vacation) => {
        return start <= vacation.endDate && end >= vacation.startDate;
      });
    },
    [vacations]
  );

  // Get current active vacation (if any)
  const getCurrentVacation = useCallback(() => {
    const now = new Date();
    return vacations.find((vacation) => {
      return now >= vacation.startDate && now <= vacation.endDate;
    });
  }, [vacations]);

  // Get upcoming vacations
  const getUpcomingVacations = useCallback(
    (withinDays = 30) => {
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(now.getDate() + withinDays);

      return vacations.filter((vacation) => {
        return vacation.startDate > now && vacation.startDate <= futureDate;
      });
    },
    [vacations]
  );

  // Format vacation period for display
  const formatVacationPeriod = useCallback((vacation) => {
    const options = { year: "numeric", month: "short", day: "numeric" };
    const startStr = vacation.startDate.toLocaleDateString("en-US", options);
    const endStr = vacation.endDate.toLocaleDateString("en-US", options);

    return `${startStr} - ${endStr}`;
  }, []);

  // Load vacations on mount
  useEffect(() => {
    fetchVacations();
  }, [fetchVacations]);

  return {
    vacations,
    loading,
    error,
    fetchVacations,
    createVacation,
    deleteVacation,
    isDateInVacation,
    getVacationsInRange,
    getCurrentVacation,
    getUpcomingVacations,
    formatVacationPeriod,
    refetch: fetchVacations,
  };
};
