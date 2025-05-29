import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
} from "firebase/firestore";
import { db, collections, handleFirebaseError } from "./config";

// Appointment status constants
export const APPOINTMENT_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
};

// Appointment service class
export class AppointmentService {
  constructor() {
    this.collectionRef = collection(db, collections.CUSTOMERS);
  }

  // Get all appointments with optional filtering and pagination
  async getAppointments(options = {}) {
    try {
      const {
        dateRange,
        status,
        limit: limitCount = 100,
        orderByField = "selectedDate",
        orderDirection = "asc",
        startAfterDoc = null,
      } = options;

      let q = query(this.collectionRef);

      // Add date range filter if provided
      if (dateRange?.start && dateRange?.end) {
        const startDate = new Date(dateRange.start);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);

        q = query(
          q,
          where("selectedDate", ">=", startDate.toISOString()),
          where("selectedDate", "<=", endDate.toISOString())
        );
      }

      // Add status filter if provided
      if (status) {
        q = query(q, where("status", "==", status));
      }

      // Add ordering
      q = query(q, orderBy(orderByField, orderDirection));

      // Add secondary ordering by startTime for same dates
      if (orderByField !== "startTime") {
        q = query(q, orderBy("startTime", "asc"));
      }

      // Add pagination
      if (startAfterDoc) {
        q = query(q, startAfter(startAfterDoc));
      }

      q = query(q, limit(limitCount));

      const querySnapshot = await getDocs(q);

      return {
        appointments: querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })),
        lastDoc: querySnapshot.docs[querySnapshot.docs.length - 1] || null,
        hasMore: querySnapshot.docs.length === limitCount,
      };
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get appointments for a specific date
  async getAppointmentsByDate(date) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const q = query(
        this.collectionRef,
        where("selectedDate", ">=", startOfDay.toISOString()),
        where("selectedDate", "<=", endOfDay.toISOString()),
        orderBy("selectedDate"),
        orderBy("startTime")
      );

      const querySnapshot = await getDocs(q);

      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get appointment by ID
  async getAppointmentById(id) {
    try {
      const docRef = doc(this.collectionRef, id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data(),
        };
      } else {
        throw new Error("Appointment not found");
      }
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Create new appointment
  async createAppointment(appointmentData) {
    try {
      const dataWithTimestamps = {
        ...appointmentData,
        status: appointmentData.status || APPOINTMENT_STATUS.CONFIRMED,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const docRef = await addDoc(this.collectionRef, dataWithTimestamps);

      return {
        id: docRef.id,
        ...dataWithTimestamps,
      };
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Create appointment with conflict checking (using transaction)
  async createAppointmentSafe(appointmentData) {
    try {
      return await runTransaction(db, async (transaction) => {
        // Check for time conflicts
        const conflicts = await this.checkTimeConflicts(
          appointmentData.selectedDate,
          appointmentData.startTime,
          appointmentData.endTime
        );

        if (conflicts.length > 0) {
          throw new Error("Time slot conflicts with existing appointment");
        }

        // Create the appointment
        const appointmentRef = doc(this.collectionRef);
        const dataWithTimestamps = {
          ...appointmentData,
          status: appointmentData.status || APPOINTMENT_STATUS.CONFIRMED,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        transaction.set(appointmentRef, dataWithTimestamps);

        return {
          id: appointmentRef.id,
          ...dataWithTimestamps,
        };
      });
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Update appointment
  async updateAppointment(id, updateData) {
    try {
      const docRef = doc(this.collectionRef, id);
      const dataWithTimestamp = {
        ...updateData,
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(docRef, dataWithTimestamp);

      return {
        id,
        ...dataWithTimestamp,
      };
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Update appointment status
  async updateAppointmentStatus(id, status, notes = "") {
    try {
      const docRef = doc(this.collectionRef, id);
      const updateData = {
        status,
        statusNotes: notes,
        statusUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(docRef, updateData);

      return updateData;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Delete appointment
  async deleteAppointment(id) {
    try {
      const docRef = doc(this.collectionRef, id);
      await deleteDoc(docRef);
      return true;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Batch operations
  async batchCreateAppointments(appointmentsData) {
    try {
      const batch = writeBatch(db);
      const results = [];

      appointmentsData.forEach((appointmentData) => {
        const appointmentRef = doc(this.collectionRef);
        const dataWithTimestamps = {
          ...appointmentData,
          status: appointmentData.status || APPOINTMENT_STATUS.CONFIRMED,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        batch.set(appointmentRef, dataWithTimestamps);
        results.push({
          id: appointmentRef.id,
          ...dataWithTimestamps,
        });
      });

      await batch.commit();
      return results;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  async batchUpdateAppointments(updates) {
    try {
      const batch = writeBatch(db);

      updates.forEach(({ id, data }) => {
        const docRef = doc(this.collectionRef, id);
        const dataWithTimestamp = {
          ...data,
          updatedAt: new Date().toISOString(),
        };
        batch.update(docRef, dataWithTimestamp);
      });

      await batch.commit();
      return true;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  async batchDeleteAppointments(ids) {
    try {
      const batch = writeBatch(db);

      ids.forEach((id) => {
        const docRef = doc(this.collectionRef, id);
        batch.delete(docRef);
      });

      await batch.commit();
      return true;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Check for time conflicts
  async checkTimeConflicts(date, startTime, endTime, excludeId = null) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const q = query(
        this.collectionRef,
        where("selectedDate", ">=", startOfDay.toISOString()),
        where("selectedDate", "<=", endOfDay.toISOString())
      );

      const querySnapshot = await getDocs(q);
      const appointments = querySnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((appointment) =>
          excludeId ? appointment.id !== excludeId : true
        );

      // Check for time overlaps
      const conflicts = appointments.filter((appointment) => {
        const appStart = this.timeToMinutes(appointment.startTime);
        const appEnd = this.timeToMinutes(appointment.endTime);
        const newStart = this.timeToMinutes(startTime);
        const newEnd = this.timeToMinutes(endTime);

        return newStart < appEnd && newEnd > appStart;
      });

      return conflicts;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get appointment statistics
  async getAppointmentStats(dateRange) {
    try {
      const appointments = await this.getAppointmentsByDateRange(
        dateRange.start,
        dateRange.end
      );

      const stats = {
        total: appointments.length,
        confirmed: appointments.filter(
          (a) => a.status === APPOINTMENT_STATUS.CONFIRMED
        ).length,
        completed: appointments.filter(
          (a) => a.status === APPOINTMENT_STATUS.COMPLETED
        ).length,
        cancelled: appointments.filter(
          (a) => a.status === APPOINTMENT_STATUS.CANCELLED
        ).length,
        noShow: appointments.filter(
          (a) => a.status === APPOINTMENT_STATUS.NO_SHOW
        ).length,
        byType: {},
        byDate: {},
      };

      // Group by appointment type
      appointments.forEach((appointment) => {
        const type = appointment.appointmentType;
        stats.byType[type] = (stats.byType[type] || 0) + 1;
      });

      // Group by date
      appointments.forEach((appointment) => {
        const date = new Date(appointment.selectedDate).toDateString();
        stats.byDate[date] = (stats.byDate[date] || 0) + 1;
      });

      return stats;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Helper method to get appointments by date range
  async getAppointmentsByDateRange(startDate, endDate) {
    try {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const q = query(
        this.collectionRef,
        where("selectedDate", ">=", start.toISOString()),
        where("selectedDate", "<=", end.toISOString()),
        orderBy("selectedDate"),
        orderBy("startTime")
      );

      const querySnapshot = await getDocs(q);

      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Utility method to convert time string to minutes
  timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
  }
}

// Create and export a singleton instance
export const appointmentService = new AppointmentService();
