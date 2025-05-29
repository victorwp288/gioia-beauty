// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyByq0llhuTY-_7eXnpknyPqU38IvQajcI0",
  authDomain: "gioia-beauty-b95e0.firebaseapp.com",
  projectId: "gioia-beauty-b95e0",
  storageBucket: "gioia-beauty-b95e0.firebasestorage.app",
  messagingSenderId: "123049235831",
  appId: "1:123049235831:web:2b07ab53e1aa8d676afd72",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
let analytics;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Connect to emulator in development (optional)
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  // Uncomment these lines if you want to use Firebase emulators
  // connectFirestoreEmulator(db, 'localhost', 8080);
  // connectAuthEmulator(auth, 'http://localhost:9099');
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
  console.error("Firebase Error:", error);

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
    code: error.code,
    message: userMessage,
    originalMessage: error.message,
    details: error.details || null,
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

// Simple read counter for monitoring
let firebaseReadCount = 0;
let dailyReadCount = 0;
let lastResetDate = "";

// Initialize localStorage values only in browser
if (typeof window !== "undefined") {
  dailyReadCount = parseInt(
    localStorage.getItem("firebase_daily_reads") || "0",
    10
  );
  lastResetDate =
    localStorage.getItem("firebase_read_reset_date") ||
    new Date().toDateString();

  // Reset daily counter if it's a new day
  if (lastResetDate !== new Date().toDateString()) {
    dailyReadCount = 0;
    localStorage.setItem("firebase_daily_reads", "0");
    localStorage.setItem("firebase_read_reset_date", new Date().toDateString());
    lastResetDate = new Date().toDateString();
  }
}

export const incrementReadCount = (operation = "unknown") => {
  firebaseReadCount++;
  dailyReadCount++;

  if (typeof window !== "undefined") {
    localStorage.setItem("firebase_daily_reads", dailyReadCount.toString());
  }

  if (dailyReadCount % 50 === 0) {
    // Log every 50 reads
    console.warn(
      `🔥 Firebase Reads: ${dailyReadCount} today, ${firebaseReadCount} this session`
    );
  }
};

export const getReadStats = () => ({
  session: firebaseReadCount,
  daily: dailyReadCount,
  lastReset: lastResetDate,
});

export { app, auth, db, storage, analytics };
