import { useState, useCallback, useRef } from "react";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const useFirestore = (collectionName) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const retryCount = useRef(0);
  const maxRetries = 3;

  // Generate cache key
  const getCacheKey = useCallback(
    (operation, params = {}) => {
      return `${collectionName}_${operation}_${JSON.stringify(params)}`;
    },
    [collectionName]
  );

  // Check if cached data is still valid
  const isCacheValid = useCallback((cacheEntry) => {
    return cacheEntry && Date.now() - cacheEntry.timestamp < CACHE_TTL;
  }, []);

  // Get data from cache if valid
  const getFromCache = useCallback(
    (key) => {
      const cacheEntry = cache.get(key);
      return isCacheValid(cacheEntry) ? cacheEntry.data : null;
    },
    [isCacheValid]
  );

  // Set data in cache
  const setCache = useCallback((key, data) => {
    cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }, []);

  // Clear cache for collection
  const clearCache = useCallback(
    (pattern = "") => {
      for (const key of cache.keys()) {
        if (key.startsWith(`${collectionName}_${pattern}`)) {
          cache.delete(key);
        }
      }
    },
    [collectionName]
  );

  // Retry wrapper for operations
  const withRetry = useCallback(async (operation) => {
    retryCount.current = 0;

    while (retryCount.current < maxRetries) {
      try {
        return await operation();
      } catch (err) {
        retryCount.current++;

        if (retryCount.current >= maxRetries) {
          throw err;
        }

        // Exponential backoff
        const delay = Math.pow(2, retryCount.current) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }, []);

  // Get all documents
  const getAll = useCallback(
    async (useCache = true, queryConstraints = []) => {
      const cacheKey = getCacheKey("getAll", { queryConstraints });

      if (useCache) {
        const cachedData = getFromCache(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      }

      setLoading(true);
      setError(null);

      try {
        const result = await withRetry(async () => {
          let q = collection(db, collectionName);

          if (queryConstraints.length > 0) {
            q = query(q, ...queryConstraints);
          }

          const querySnapshot = await getDocs(q);
          return querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
        });

        if (useCache) {
          setCache(cacheKey, result);
        }

        return result;
      } catch (err) {
        setError(err.message);
        console.error(
          `Error getting all documents from ${collectionName}:`,
          err
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [collectionName, getCacheKey, getFromCache, setCache, withRetry]
  );

  // Get document by ID
  const getById = useCallback(
    async (id, useCache = true) => {
      const cacheKey = getCacheKey("getById", { id });

      if (useCache) {
        const cachedData = getFromCache(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      }

      setLoading(true);
      setError(null);

      try {
        const result = await withRetry(async () => {
          const docRef = doc(db, collectionName, id);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            return {
              id: docSnap.id,
              ...docSnap.data(),
            };
          } else {
            throw new Error("Document not found");
          }
        });

        if (useCache) {
          setCache(cacheKey, result);
        }

        return result;
      } catch (err) {
        setError(err.message);
        console.error(
          `Error getting document ${id} from ${collectionName}:`,
          err
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [collectionName, getCacheKey, getFromCache, setCache, withRetry]
  );

  // Query documents with conditions
  const queryDocs = useCallback(
    async (conditions, useCache = true) => {
      const cacheKey = getCacheKey("query", conditions);

      if (useCache) {
        const cachedData = getFromCache(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      }

      setLoading(true);
      setError(null);

      try {
        const result = await withRetry(async () => {
          let q = collection(db, collectionName);

          // Apply where conditions
          if (conditions.where) {
            conditions.where.forEach(([field, operator, value]) => {
              q = query(q, where(field, operator, value));
            });
          }

          // Apply ordering
          if (conditions.orderBy) {
            conditions.orderBy.forEach(([field, direction = "asc"]) => {
              q = query(q, orderBy(field, direction));
            });
          }

          // Apply limit
          if (conditions.limit) {
            q = query(q, limit(conditions.limit));
          }

          const querySnapshot = await getDocs(q);
          return querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
        });

        if (useCache) {
          setCache(cacheKey, result);
        }

        return result;
      } catch (err) {
        setError(err.message);
        console.error(`Error querying ${collectionName}:`, err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [collectionName, getCacheKey, getFromCache, setCache, withRetry]
  );

  // Add new document
  const add = useCallback(
    async (data) => {
      setLoading(true);
      setError(null);

      try {
        const result = await withRetry(async () => {
          const docRef = await addDoc(collection(db, collectionName), {
            ...data,
            createdAt: new Date().toISOString(),
          });

          return {
            id: docRef.id,
            ...data,
            createdAt: new Date().toISOString(),
          };
        });

        // Clear cache as data has changed
        clearCache();

        return result;
      } catch (err) {
        setError(err.message);
        console.error(`Error adding document to ${collectionName}:`, err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [collectionName, clearCache, withRetry]
  );

  // Update document
  const update = useCallback(
    async (id, data) => {
      setLoading(true);
      setError(null);

      try {
        const result = await withRetry(async () => {
          const docRef = doc(db, collectionName, id);
          const updateData = {
            ...data,
            updatedAt: new Date().toISOString(),
          };

          await updateDoc(docRef, updateData);

          return {
            id,
            ...updateData,
          };
        });

        // Clear cache as data has changed
        clearCache();

        return result;
      } catch (err) {
        setError(err.message);
        console.error(
          `Error updating document ${id} in ${collectionName}:`,
          err
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [collectionName, clearCache, withRetry]
  );

  // Delete document
  const remove = useCallback(
    async (id) => {
      setLoading(true);
      setError(null);

      try {
        await withRetry(async () => {
          const docRef = doc(db, collectionName, id);
          await deleteDoc(docRef);
        });

        // Clear cache as data has changed
        clearCache();

        return true;
      } catch (err) {
        setError(err.message);
        console.error(
          `Error deleting document ${id} from ${collectionName}:`,
          err
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [collectionName, clearCache, withRetry]
  );

  return {
    loading,
    error,
    getAll,
    getById,
    queryDocs,
    add,
    update,
    remove,
    clearCache,
  };
};
