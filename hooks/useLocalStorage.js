import { useState, useEffect, useCallback } from "react";

export const useLocalStorage = (key, initialValue) => {
  // Get from local storage then parse stored json or return initialValue
  const [storedValue, setStoredValue] = useState(() => {
    if (typeof window === "undefined") {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that persists the new value to localStorage
  const setValue = useCallback(
    (value) => {
      try {
        // Allow value to be a function so we have the same API as useState
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;

        // Save state
        setStoredValue(valueToStore);

        // Save to local storage
        if (typeof window !== "undefined") {
          if (valueToStore === undefined) {
            window.localStorage.removeItem(key);
          } else {
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
          }
        }
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  // Remove the item from localStorage
  const removeValue = useCallback(() => {
    try {
      setStoredValue(initialValue);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue]);

  // Check if localStorage is available
  const isAvailable = useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }

    try {
      const testKey = "__localStorage_test__";
      window.localStorage.setItem(testKey, "test");
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Get the current storage usage (approximate)
  const getStorageSize = useCallback(() => {
    if (typeof window === "undefined") {
      return 0;
    }

    try {
      let total = 0;
      for (let key in window.localStorage) {
        if (window.localStorage.hasOwnProperty(key)) {
          total += window.localStorage[key].length + key.length;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }, []);

  // Listen for storage changes from other tabs/windows
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorageChange = (e) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setStoredValue(JSON.parse(e.newValue));
        } catch (error) {
          console.warn(
            `Error parsing localStorage value for key "${key}":`,
            error
          );
        }
      } else if (e.key === key && e.newValue === null) {
        setStoredValue(initialValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [key, initialValue]);

  return {
    value: storedValue,
    setValue,
    removeValue,
    isAvailable,
    getStorageSize,
  };
};

// Helper hook for managing multiple localStorage keys with a prefix
export const useLocalStorageState = (prefix = "") => {
  const setItem = useCallback(
    (key, value) => {
      const fullKey = prefix ? `${prefix}_${key}` : key;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(fullKey, JSON.stringify(value));
        }
      } catch (error) {
        console.warn(`Error setting localStorage key "${fullKey}":`, error);
      }
    },
    [prefix]
  );

  const getItem = useCallback(
    (key, defaultValue = null) => {
      const fullKey = prefix ? `${prefix}_${key}` : key;
      try {
        if (typeof window !== "undefined") {
          const item = window.localStorage.getItem(fullKey);
          return item ? JSON.parse(item) : defaultValue;
        }
        return defaultValue;
      } catch (error) {
        console.warn(`Error reading localStorage key "${fullKey}":`, error);
        return defaultValue;
      }
    },
    [prefix]
  );

  const removeItem = useCallback(
    (key) => {
      const fullKey = prefix ? `${prefix}_${key}` : key;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(fullKey);
        }
      } catch (error) {
        console.warn(`Error removing localStorage key "${fullKey}":`, error);
      }
    },
    [prefix]
  );

  const clearAll = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const keysToRemove = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && (prefix ? key.startsWith(`${prefix}_`) : true)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => window.localStorage.removeItem(key));
    } catch (error) {
      console.warn("Error clearing localStorage:", error);
    }
  }, [prefix]);

  const getAllKeys = useCallback(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && (prefix ? key.startsWith(`${prefix}_`) : true)) {
          keys.push(prefix ? key.replace(`${prefix}_`, "") : key);
        }
      }
      return keys;
    } catch (error) {
      console.warn("Error getting localStorage keys:", error);
      return [];
    }
  }, [prefix]);

  return {
    setItem,
    getItem,
    removeItem,
    clearAll,
    getAllKeys,
  };
};
