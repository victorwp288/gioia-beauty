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
} from "firebase/firestore";
import { db, collections, handleFirebaseError } from "./config";

// Vacation service class
export class VacationService {
  constructor() {
    this.collectionRef = collection(db, collections.VACATIONS);
  }

  // Get all vacation periods
  async getVacations(options = {}) {
    try {
      const {
        includeExpired = true,
        orderByField = "startDate",
        orderDirection = "asc",
        limitCount = 100,
      } = options;

      let q = query(this.collectionRef);

      // Filter out expired vacations if requested
      if (!includeExpired) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        q = query(q, where("endDate", ">=", today.toISOString()));
      }

      // Add ordering
      q = query(q, orderBy(orderByField, orderDirection));

      // Add limit
      if (limitCount) {
        q = query(q, limit(limitCount));
      }

      const querySnapshot = await getDocs(q);

      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        startDate: new Date(doc.data().startDate),
        endDate: new Date(doc.data().endDate),
      }));
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get vacation by ID
  async getVacationById(id) {
    try {
      const docRef = doc(this.collectionRef, id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
        };
      } else {
        throw new Error("Vacation period not found");
      }
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get active vacation periods for a specific date range
  async getVacationsInRange(startDate, endDate) {
    try {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const q = query(
        this.collectionRef,
        where("startDate", "<=", end.toISOString()),
        where("endDate", ">=", start.toISOString()),
        orderBy("startDate")
      );

      const querySnapshot = await getDocs(q);

      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        startDate: new Date(doc.data().startDate),
        endDate: new Date(doc.data().endDate),
      }));
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get current active vacation (if any)
  async getCurrentVacation() {
    try {
      const now = new Date();
      const today = now.toISOString();

      const q = query(
        this.collectionRef,
        where("startDate", "<=", today),
        where("endDate", ">=", today),
        orderBy("startDate"),
        limit(1)
      );

      const querySnapshot = await getDocs(q);

      if (querySnapshot.docs.length > 0) {
        const doc = querySnapshot.docs[0];
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
        };
      }

      return null;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get upcoming vacations
  async getUpcomingVacations(withinDays = 30) {
    try {
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(now.getDate() + withinDays);

      const q = query(
        this.collectionRef,
        where("startDate", ">", now.toISOString()),
        where("startDate", "<=", futureDate.toISOString()),
        orderBy("startDate")
      );

      const querySnapshot = await getDocs(q);

      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        startDate: new Date(doc.data().startDate),
        endDate: new Date(doc.data().endDate),
      }));
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Check if a specific date is during a vacation period
  async isDateInVacation(date) {
    try {
      const checkDate = new Date(date);
      checkDate.setHours(12, 0, 0, 0); // Use noon to avoid timezone issues
      const dateString = checkDate.toISOString();

      const q = query(
        this.collectionRef,
        where("startDate", "<=", dateString),
        where("endDate", ">=", dateString),
        limit(1)
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.length > 0;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Validate vacation period data
  validateVacationData(startDate, endDate, reason = "") {
    const errors = [];

    // Check if dates are provided
    if (!startDate) {
      errors.push("Start date is required");
    }

    if (!endDate) {
      errors.push("End date is required");
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Check if end date is after start date
      if (end < start) {
        errors.push("End date must be after start date");
      }

      // Check if vacation is too long (optional business rule)
      const daysDifference = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      if (daysDifference > 365) {
        errors.push("Vacation period cannot exceed 365 days");
      }
    }

    // Validate reason length
    if (reason && reason.length > 500) {
      errors.push("Reason cannot exceed 500 characters");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Check for overlaps with existing vacation periods
  async checkVacationOverlaps(startDate, endDate, excludeId = null) {
    try {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const overlappingVacations = await this.getVacationsInRange(start, end);

      // Filter out the excluded vacation if updating
      const conflicts = overlappingVacations.filter((vacation) =>
        excludeId ? vacation.id !== excludeId : true
      );

      return conflicts;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Create new vacation period
  async createVacation(startDate, endDate, reason = "") {
    try {
      // Validate input data
      const validation = this.validateVacationData(startDate, endDate, reason);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(", "));
      }

      // Check for overlaps
      const overlaps = await this.checkVacationOverlaps(startDate, endDate);
      if (overlaps.length > 0) {
        throw new Error("This vacation period overlaps with an existing one");
      }

      const vacationData = {
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        reason: reason.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const docRef = await addDoc(this.collectionRef, vacationData);

      return {
        id: docRef.id,
        ...vacationData,
        startDate: new Date(vacationData.startDate),
        endDate: new Date(vacationData.endDate),
      };
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Create vacation period with transaction (safe)
  async createVacationSafe(startDate, endDate, reason = "") {
    console.log(
      "🔐 VacationService: Starting createVacationSafe with auth check..."
    );

    try {
      // Check authentication state
      const { auth } = await import("./config");
      const user = auth.currentUser;
      console.log(
        "🔐 Current user:",
        user ? { uid: user.uid, email: user.email } : "No user"
      );

      if (!user) {
        console.error("❌ VacationService: User not authenticated!");
        throw new Error("User must be authenticated to create vacations");
      }

      console.log(
        "✅ VacationService: User authenticated, proceeding with transaction..."
      );

      return await runTransaction(db, async (transaction) => {
        console.log(
          "📝 VacationService: Inside transaction, validating data..."
        );

        // Validate input data
        const validation = this.validateVacationData(
          startDate,
          endDate,
          reason
        );
        if (!validation.isValid) {
          console.error(
            "❌ VacationService: Validation failed:",
            validation.errors
          );
          throw new Error(validation.errors.join(", "));
        }

        console.log(
          "✅ VacationService: Validation passed, checking overlaps..."
        );

        // Check for overlaps within transaction
        const overlaps = await this.checkVacationOverlaps(startDate, endDate);
        if (overlaps.length > 0) {
          console.error("❌ VacationService: Overlaps found:", overlaps);
          throw new Error("This vacation period overlaps with an existing one");
        }

        console.log("✅ VacationService: No overlaps, creating document...");

        const vacationRef = doc(this.collectionRef);
        const vacationData = {
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          reason: reason.trim(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        console.log(
          "💾 VacationService: Setting document with data:",
          vacationData
        );
        transaction.set(vacationRef, vacationData);

        const result = {
          id: vacationRef.id,
          ...vacationData,
          startDate: new Date(vacationData.startDate),
          endDate: new Date(vacationData.endDate),
        };

        console.log(
          "✅ VacationService: Transaction completed successfully:",
          result
        );
        return result;
      });
    } catch (error) {
      console.error("❌ VacationService: createVacationSafe failed:", error);
      console.error("Error details:", {
        code: error.code,
        message: error.message,
        stack: error.stack,
      });
      throw handleFirebaseError(error);
    }
  }

  // Update vacation period with individual parameters (for hook compatibility)
  async updateVacation(id, startDate, endDate, reason = "") {
    try {
      console.log("🏖️ VacationService: Updating vacation with params:", {
        id,
        startDate,
        endDate,
        reason,
      });

      if (!id) {
        throw new Error("Vacation ID is required for update");
      }

      const updateData = {
        startDate: startDate,
        endDate: endDate,
        reason: reason,
      };

      const result = await this.updateVacationData(id, updateData);
      console.log("✅ VacationService: Vacation updated successfully:", result);
      return result;
    } catch (error) {
      console.error("❌ VacationService: Update vacation failed:", error);
      throw handleFirebaseError(error);
    }
  }

  // Update vacation period with data object
  async updateVacationData(id, updateData) {
    try {
      const { startDate, endDate, reason } = updateData;

      // Validate if dates are being updated
      if (startDate || endDate) {
        const current = await this.getVacationById(id);
        const newStartDate = startDate || current.startDate;
        const newEndDate = endDate || current.endDate;

        const validation = this.validateVacationData(
          newStartDate,
          newEndDate,
          reason
        );
        if (!validation.isValid) {
          throw new Error(validation.errors.join(", "));
        }

        // Check for overlaps (excluding current vacation)
        const overlaps = await this.checkVacationOverlaps(
          newStartDate,
          newEndDate,
          id
        );
        if (overlaps.length > 0) {
          throw new Error("This vacation period overlaps with an existing one");
        }
      }

      const docRef = doc(this.collectionRef, id);
      const dataToUpdate = {
        reason: reason, // Always include reason
        updatedAt: new Date().toISOString(),
      };

      // Only update dates if provided
      if (startDate) {
        dataToUpdate.startDate =
          startDate instanceof Date
            ? startDate.toISOString()
            : new Date(startDate).toISOString();
      }

      if (endDate) {
        dataToUpdate.endDate =
          endDate instanceof Date
            ? endDate.toISOString()
            : new Date(endDate).toISOString();
      }

      console.log(
        "🏖️ VacationService: Updating document with data:",
        dataToUpdate
      );

      await updateDoc(docRef, dataToUpdate);

      // Fetch the updated document to ensure we have the correct data
      const updatedDoc = await this.getVacationById(id);

      console.log(
        "🏖️ VacationService: Retrieved updated document:",
        updatedDoc
      );

      return updatedDoc;
    } catch (error) {
      console.error("🏖️ VacationService: updateVacationData error:", error);
      throw handleFirebaseError(error);
    }
  }

  // Delete vacation period
  async deleteVacation(id) {
    console.log("🗑️ VacationService: Starting delete for vacation:", id);

    try {
      if (!id) {
        throw new Error("Vacation ID is required for deletion");
      }

      const docRef = doc(this.collectionRef, id);
      console.log("🗑️ VacationService: Calling deleteDoc for:", id);

      await deleteDoc(docRef);
      console.log("✅ VacationService: Vacation deleted successfully:", id);

      return true;
    } catch (error) {
      console.error("❌ VacationService: Delete vacation failed:", error);
      throw handleFirebaseError(error);
    }
  }

  // Batch operations
  async batchCreateVacations(vacationsData) {
    try {
      // Validate all vacations first
      for (const vacationData of vacationsData) {
        const validation = this.validateVacationData(
          vacationData.startDate,
          vacationData.endDate,
          vacationData.reason
        );
        if (!validation.isValid) {
          throw new Error(
            `Invalid vacation data: ${validation.errors.join(", ")}`
          );
        }
      }

      const batch = writeBatch(db);
      const results = [];

      vacationsData.forEach((vacationData) => {
        const vacationRef = doc(this.collectionRef);
        const dataWithTimestamps = {
          startDate: new Date(vacationData.startDate).toISOString(),
          endDate: new Date(vacationData.endDate).toISOString(),
          reason: vacationData.reason?.trim() || "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        batch.set(vacationRef, dataWithTimestamps);
        results.push({
          id: vacationRef.id,
          ...dataWithTimestamps,
          startDate: new Date(dataWithTimestamps.startDate),
          endDate: new Date(dataWithTimestamps.endDate),
        });
      });

      await batch.commit();
      return results;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  async batchDeleteVacations(ids) {
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

  // Utility methods for date formatting and comparison
  formatVacationPeriod(vacation) {
    const options = { year: "numeric", month: "short", day: "numeric" };
    const startStr = vacation.startDate.toLocaleDateString("en-US", options);
    const endStr = vacation.endDate.toLocaleDateString("en-US", options);
    return `${startStr} - ${endStr}`;
  }

  getDaysBetween(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const timeDifference = end.getTime() - start.getTime();
    return Math.ceil(timeDifference / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
  }

  isVacationActive(vacation) {
    const now = new Date();
    return vacation.startDate <= now && vacation.endDate >= now;
  }

  isVacationUpcoming(vacation, withinDays = 7) {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + withinDays);
    return vacation.startDate > now && vacation.startDate <= futureDate;
  }
}

// Create and export a singleton instance
export const vacationService = new VacationService();
