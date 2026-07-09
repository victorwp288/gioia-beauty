// Import the functions you need from the SDKs you need
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV || "invalid";
const isIsolatedEnvironment = ["local", "test", "preview"].includes(
  appEnvironment
);

const isolatedFirebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: "127.0.0.1",
  projectId: "demo-gioia-beauty",
  storageBucket: "demo-gioia-beauty.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000",
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const resolvedFirebaseConfig = isIsolatedEnvironment
  ? isolatedFirebaseConfig
  : firebaseConfig;

if (!isIsolatedEnvironment && Object.values(resolvedFirebaseConfig).some((value) => !value)) {
  throw new Error("Firebase configuration is unavailable in this environment");
}

// Initialize Firebase
const app = getApps().length ? getApp() : initializeApp(resolvedFirebaseConfig);

// Initialize services
let analytics;
if (appEnvironment === "production" && typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

if (isIsolatedEnvironment) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

// Collection references for easier access
export const collections = {
  CUSTOMERS: "customers",
  VACATIONS: "vacations",
  NEWSLETTER_SUBSCRIBERS: "newsletter_subscribers",
  SETTINGS: "settings",
  ANALYTICS: "analytics",
};

// Error handling utilities
export const handleFirebaseError = (error) => {
  console.error("Firebase operation failed", {
    code: error?.code || "unknown",
  });

  // Map Firebase error codes to user-friendly messages
  const errorMessages = {
    "permission-denied": "You do not have permission to perform this action.",
    unavailable: "Service temporarily unavailable. Please try again later.",
    "deadline-exceeded": "Request timed out. Please try again.",
    "resource-exhausted": "Too many requests. Please try again later.",
    unauthenticated: "Please log in to continue.",
    "not-found": "The requested data was not found.",
    "already-exists": "This data already exists.",
    "failed-precondition": "Operation failed due to invalid conditions.",
    "out-of-range": "Invalid input range.",
    unimplemented: "This feature is not yet implemented.",
    internal: "Internal server error. Please try again later.",
    cancelled: "Operation was cancelled.",
    "data-loss": "Data loss detected. Please contact support.",
  };

  const userMessage =
    errorMessages[error.code] ||
    "An unexpected error occurred. Please try again.";

  return {
    code: error?.code || "unknown",
    message: userMessage,
  };
};

// Connection status utilities
export const checkFirebaseConnection = async () => {
  try {
    const testDoc = await db._delegate._databaseId;
    return { connected: true, projectId: testDoc.projectId };
  } catch (error) {
    return { connected: false, error: handleFirebaseError(error) };
  }
};

// Simple read monitoring (add this at the end of the file)
let dailyReadCount = 0;
let lastResetDate = new Date().toDateString();

export const trackDatabaseRead = (operation = "unknown", count = 1) => {
  const today = new Date().toDateString();

  // Reset counter if it's a new day
  if (today !== lastResetDate) {
    console.log(`📊 Previous day total reads: ${dailyReadCount}`);
    dailyReadCount = 0;
    lastResetDate = today;
  }

  dailyReadCount += count;
  console.log(
    `📊 Database read: ${operation} (+${count}) | Today's total: ${dailyReadCount}`
  );

  // Warn if approaching problematic levels
  if (dailyReadCount > 1000) {
    console.warn(`⚠️ High read count today: ${dailyReadCount} reads`);
  }
};

// Export read counter for monitoring
export const getReadStats = () => ({
  dailyReads: dailyReadCount,
  date: lastResetDate,
});

export { app, auth, db, storage, analytics };
