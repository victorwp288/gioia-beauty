// Simple script to export newsletter_subscribers from old Firebase project
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from "fs";

// Your old Firebase config
const oldFirebaseConfig = {
  apiKey: "AIzaSyAuWwmKaTpYR4AlGaRo1CXDkUb_XlaOinU",
  authDomain: "clinic-418813.firebaseapp.com",
  projectId: "clinic-418813",
  storageBucket: "clinic-418813.firebasestorage.app",
  messagingSenderId: "988012998371",
  appId: "1:988012998371:web:85f7ca36a9154e3c799fd6",
  measurementId: "G-5HM2L5RPHD",
};

console.log("🚀 Starting newsletter export from old Firebase...");

async function exportNewsletterSubscribers() {
  try {
    // Initialize Firebase app for old project
    const app = initializeApp(oldFirebaseConfig, "export-app");
    const db = getFirestore(app);

    console.log("📡 Connecting to old Firebase project...");

    // Get newsletter_subscribers collection
    const collectionRef = collection(db, "newsletter_subscribers");
    console.log("📋 Fetching newsletter subscribers...");

    const snapshot = await getDocs(collectionRef);

    if (snapshot.empty) {
      console.log("📭 No newsletter subscribers found in the collection");
      return;
    }

    console.log(`📊 Found ${snapshot.docs.length} newsletter subscribers`);

    // Convert to exportable format
    const subscribers = {};
    snapshot.docs.forEach((doc) => {
      subscribers[doc.id] = {
        ...doc.data(),
        exportedAt: new Date().toISOString(),
        originalId: doc.id,
      };
    });

    // Save to JSON file
    const filename = "./scripts/newsletter_subscribers_export.json";
    fs.writeFileSync(filename, JSON.stringify(subscribers, null, 2));

    console.log(
      `✅ Export completed! Saved ${snapshot.docs.length} subscribers to ${filename}`
    );
    console.log("📋 Sample data:");
    if (snapshot.docs.length > 0) {
      const sample = snapshot.docs[0].data();
      console.log(JSON.stringify(sample, null, 2));
    }

    console.log("\n🎯 Next steps:");
    console.log(
      "1. Review the exported data in newsletter_subscribers_export.json"
    );
    console.log("2. Run: npm run import:newsletter");
  } catch (error) {
    console.error("❌ Export failed:", error);

    if (error.code === "permission-denied") {
      console.log("\n🔒 Permission denied. This might be because:");
      console.log("1. Firestore security rules don't allow reads");
      console.log("2. You need to be authenticated");
      console.log("3. The collection doesn't exist");
    }

    throw error;
  }
}

exportNewsletterSubscribers()
  .then(() => {
    console.log("🎉 Export process completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Export process failed:", error.message);
    process.exit(1);
  });
