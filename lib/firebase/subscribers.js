import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db, collections, handleFirebaseError } from "./config";
import {
  cacheSubscribers,
  getCachedSubscribers,
  invalidateTags,
} from "@/lib/cache/queryCache";

// Subscriber status constants
export const SUBSCRIBER_STATUS = {
  ACTIVE: "active",
  UNSUBSCRIBED: "unsubscribed",
  BOUNCED: "bounced",
  COMPLAINED: "complained",
};

// Newsletter subscriber service class
export class SubscriberService {
  constructor() {
    this.collectionRef = collection(db, collections.NEWSLETTER_SUBSCRIBERS);
  }

  // Get all subscribers with optional filtering
  async getSubscribers(options = {}) {
    try {
      const {
        status = SUBSCRIBER_STATUS.ACTIVE,
        orderByField = "subscribedAt",
        orderDirection = "desc",
        limitCount = 100,
      } = options;

      // Check cache first
      const cacheKey = { status, orderByField, orderDirection, limitCount };
      const cached = getCachedSubscribers(cacheKey);
      if (cached) {
        console.log("🎯 Returning cached subscribers:", cached.length);
        return cached;
      }

      console.log("📡 Fetching subscribers from Firebase...");
      let q = query(this.collectionRef);

      // Add status filter
      if (status) {
        q = query(q, where("status", "==", status));
      }

      // Add ordering
      q = query(q, orderBy(orderByField, orderDirection));

      // Add limit
      if (limitCount) {
        q = query(q, limit(limitCount));
      }

      const querySnapshot = await getDocs(q);

      const result = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Cache the results
      cacheSubscribers(cacheKey, result);
      console.log("💾 Cached subscribers:", result.length);

      return result;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get subscriber by ID
  async getSubscriberById(id) {
    try {
      const docRef = doc(this.collectionRef, id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data(),
        };
      } else {
        throw new Error("Subscriber not found");
      }
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Get subscriber by email
  async getSubscriberByEmail(email) {
    try {
      const q = query(
        this.collectionRef,
        where("email", "==", email.toLowerCase().trim()),
        limit(1)
      );

      const querySnapshot = await getDocs(q);

      if (querySnapshot.docs.length > 0) {
        const doc = querySnapshot.docs[0];
        return {
          id: doc.id,
          ...doc.data(),
        };
      }

      return null;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Check if email is already subscribed
  async isEmailSubscribed(email) {
    try {
      const subscriber = await this.getSubscriberByEmail(email);
      return subscriber && subscriber.status === SUBSCRIBER_STATUS.ACTIVE;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Validate email format
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Validate subscriber data
  validateSubscriberData(email, name = "") {
    const errors = [];

    // Check if email is provided
    if (!email) {
      errors.push("Email is required");
    } else {
      // Validate email format
      if (!this.validateEmail(email)) {
        errors.push("Invalid email format");
      }
    }

    // Validate name length if provided
    if (name && name.length > 100) {
      errors.push("Name cannot exceed 100 characters");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Subscribe new email
  async subscribe(email, name = "", source = "website") {
    try {
      const normalizedEmail = email.toLowerCase().trim();

      // Validate input data
      const validation = this.validateSubscriberData(normalizedEmail, name);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(", "));
      }

      // Check if email is already subscribed
      const existingSubscriber = await this.getSubscriberByEmail(
        normalizedEmail
      );

      if (existingSubscriber) {
        if (existingSubscriber.status === SUBSCRIBER_STATUS.ACTIVE) {
          throw new Error("Email is already subscribed");
        } else {
          // Reactivate if previously unsubscribed
          return await this.updateSubscriberStatus(
            existingSubscriber.id,
            SUBSCRIBER_STATUS.ACTIVE,
            "Resubscribed"
          );
        }
      }

      const subscriberData = {
        email: normalizedEmail,
        name: name.trim(),
        status: SUBSCRIBER_STATUS.ACTIVE,
        source,
        subscribedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const docRef = await addDoc(this.collectionRef, subscriberData);

      // Invalidate cache after adding new subscriber
      invalidateTags("subscribers");

      return {
        id: docRef.id,
        ...subscriberData,
      };
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Unsubscribe email
  async unsubscribe(email, reason = "User request") {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const subscriber = await this.getSubscriberByEmail(normalizedEmail);

      if (!subscriber) {
        throw new Error("Email not found in subscription list");
      }

      if (subscriber.status === SUBSCRIBER_STATUS.UNSUBSCRIBED) {
        throw new Error("Email is already unsubscribed");
      }

      return await this.updateSubscriberStatus(
        subscriber.id,
        SUBSCRIBER_STATUS.UNSUBSCRIBED,
        reason
      );
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Update subscriber status
  async updateSubscriberStatus(id, status, reason = "") {
    try {
      const docRef = doc(this.collectionRef, id);
      const updateData = {
        status,
        statusReason: reason,
        statusUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Add specific timestamp for unsubscribe
      if (status === SUBSCRIBER_STATUS.UNSUBSCRIBED) {
        updateData.unsubscribedAt = new Date().toISOString();
      }

      await updateDoc(docRef, updateData);

      return {
        id,
        ...updateData,
      };
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Update subscriber information
  async updateSubscriber(id, updateData) {
    try {
      const { email, name } = updateData;

      // Validate if email is being updated
      if (email) {
        const normalizedEmail = email.toLowerCase().trim();
        const validation = this.validateSubscriberData(normalizedEmail, name);
        if (!validation.isValid) {
          throw new Error(validation.errors.join(", "));
        }

        // Check if new email is already taken
        const existingSubscriber = await this.getSubscriberByEmail(
          normalizedEmail
        );
        if (existingSubscriber && existingSubscriber.id !== id) {
          throw new Error("Email is already in use");
        }

        updateData.email = normalizedEmail;
      }

      const docRef = doc(this.collectionRef, id);
      const dataToUpdate = {
        ...updateData,
        updatedAt: new Date().toISOString(),
      };

      // Trim name if provided
      if (dataToUpdate.name) {
        dataToUpdate.name = dataToUpdate.name.trim();
      }

      await updateDoc(docRef, dataToUpdate);

      return {
        id,
        ...dataToUpdate,
      };
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Delete subscriber (hard delete)
  async deleteSubscriber(id) {
    try {
      const docRef = doc(this.collectionRef, id);
      await deleteDoc(docRef);

      // Invalidate cache after deleting subscriber
      invalidateTags("subscribers");

      return true;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Batch operations
  async batchSubscribe(emailList, source = "bulk_import") {
    try {
      const batch = writeBatch(db);
      const results = [];
      const errors = [];

      for (const item of emailList) {
        const { email, name = "" } =
          typeof item === "string" ? { email: item } : item;
        const normalizedEmail = email.toLowerCase().trim();

        // Validate each email
        const validation = this.validateSubscriberData(normalizedEmail, name);
        if (!validation.isValid) {
          errors.push({ email: normalizedEmail, errors: validation.errors });
          continue;
        }

        // Check for duplicates in existing data
        const existingSubscriber = await this.getSubscriberByEmail(
          normalizedEmail
        );
        if (existingSubscriber) {
          if (existingSubscriber.status === SUBSCRIBER_STATUS.ACTIVE) {
            errors.push({
              email: normalizedEmail,
              errors: ["Already subscribed"],
            });
            continue;
          }
        }

        const subscriberRef = doc(this.collectionRef);
        const subscriberData = {
          email: normalizedEmail,
          name: name.trim(),
          status: SUBSCRIBER_STATUS.ACTIVE,
          source,
          subscribedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        batch.set(subscriberRef, subscriberData);
        results.push({
          id: subscriberRef.id,
          ...subscriberData,
        });
      }

      if (results.length > 0) {
        await batch.commit();
      }

      return {
        success: results,
        errors,
        totalProcessed: emailList.length,
        successCount: results.length,
        errorCount: errors.length,
      };
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  async batchUpdateStatus(ids, status, reason = "") {
    try {
      const batch = writeBatch(db);

      ids.forEach((id) => {
        const docRef = doc(this.collectionRef, id);
        const updateData = {
          status,
          statusReason: reason,
          statusUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Add specific timestamp for unsubscribe
        if (status === SUBSCRIBER_STATUS.UNSUBSCRIBED) {
          updateData.unsubscribedAt = new Date().toISOString();
        }

        batch.update(docRef, updateData);
      });

      await batch.commit();
      return true;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  async batchDeleteSubscribers(ids) {
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

  // Get subscription statistics
  async getSubscriberStats() {
    try {
      const allSubscribers = await this.getSubscribers({
        status: null,
        limitCount: null,
      });

      const stats = {
        total: allSubscribers.length,
        active: allSubscribers.filter(
          (s) => s.status === SUBSCRIBER_STATUS.ACTIVE
        ).length,
        unsubscribed: allSubscribers.filter(
          (s) => s.status === SUBSCRIBER_STATUS.UNSUBSCRIBED
        ).length,
        bounced: allSubscribers.filter(
          (s) => s.status === SUBSCRIBER_STATUS.BOUNCED
        ).length,
        complained: allSubscribers.filter(
          (s) => s.status === SUBSCRIBER_STATUS.COMPLAINED
        ).length,
        bySource: {},
        recentSubscriptions: 0,
      };

      // Group by source
      allSubscribers.forEach((subscriber) => {
        const source = subscriber.source || "unknown";
        stats.bySource[source] = (stats.bySource[source] || 0) + 1;
      });

      // Count recent subscriptions (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      stats.recentSubscriptions = allSubscribers.filter((subscriber) => {
        return new Date(subscriber.subscribedAt) >= thirtyDaysAgo;
      }).length;

      return stats;
    } catch (error) {
      throw handleFirebaseError(error);
    }
  }

  // Export subscribers to CSV format
  exportToCSV(subscribers) {
    const headers = ["Email", "Name", "Status", "Subscribed At", "Source"];
    const csvContent = [
      headers.join(","),
      ...subscribers.map((subscriber) =>
        [
          subscriber.email,
          subscriber.name || "",
          subscriber.status,
          new Date(subscriber.subscribedAt).toLocaleDateString(),
          subscriber.source || "",
        ]
          .map((field) => `"${field}"`)
          .join(",")
      ),
    ].join("\n");

    return csvContent;
  }

  // Import from CSV format
  parseCSV(csvContent) {
    const lines = csvContent.split("\n").filter((line) => line.trim());
    const headers = lines[0]
      .split(",")
      .map((h) => h.replace(/"/g, "").trim().toLowerCase());

    const emailIndex = headers.findIndex((h) => h.includes("email"));
    const nameIndex = headers.findIndex((h) => h.includes("name"));

    if (emailIndex === -1) {
      throw new Error("CSV must contain an email column");
    }

    const subscribers = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.replace(/"/g, "").trim());

      if (values[emailIndex]) {
        subscribers.push({
          email: values[emailIndex],
          name: nameIndex !== -1 ? values[nameIndex] : "",
        });
      }
    }

    return subscribers;
  }
}

// Create and export a singleton instance
export const subscriberService = new SubscriberService();
