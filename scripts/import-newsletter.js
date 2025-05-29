// Script to import newsletter_subscribers to new Firebase project
import { initializeApp } from "firebase/app";
import { getFirestore, collection, writeBatch, doc } from "firebase/firestore";
import fs from "fs";

// Your new Firebase config
const newFirebaseConfig = {
  apiKey: "AIzaSyAl_xxknfevk5HnnqZRCwnubYuSSLgF_UA",
  authDomain: "gioia-beauty.firebaseapp.com",
  projectId: "gioia-beauty",
  storageBucket: "gioia-beauty.firebasestorage.app",
  messagingSenderId: "455156047177",
  appId: "1:455156047177:web:d58a2237146b83742b0e98",
};

console.log("🚀 Starting newsletter import to new Firebase...");

async function importNewsletterSubscribers() {
  try {
    // Check if export file exists
    const filename = "./scripts/newsletter_subscribers_export.json";
    if (!fs.existsSync(filename)) {
      console.log("❌ Export file not found!");
      console.log("📋 Please run: npm run export:newsletter first");
      return;
    }

    // Read exported data
    console.log("📖 Reading exported newsletter subscribers...");
    const data = JSON.parse(fs.readFileSync(filename, "utf8"));
    const subscriberIds = Object.keys(data);

    if (subscriberIds.length === 0) {
      console.log("📭 No subscribers found in export file");
      return;
    }

    console.log(`📊 Found ${subscriberIds.length} subscribers to import`);

    // Initialize Firebase app for new project
    const app = initializeApp(newFirebaseConfig, "import-app");
    const db = getFirestore(app);

    console.log("📡 Connecting to new Firebase project...");

    // Import using batches (Firestore limit is 500 operations per batch)
    const batchSize = 500;
    let imported = 0;

    for (let i = 0; i < subscriberIds.length; i += batchSize) {
      const batch = writeBatch(db);
      const batchIds = subscriberIds.slice(i, i + batchSize);

      console.log(
        `📦 Preparing batch ${Math.floor(i / batchSize) + 1} with ${
          batchIds.length
        } subscribers...`
      );

      batchIds.forEach((id) => {
        const subscriberData = data[id];
        const docRef = doc(collection(db, "newsletter_subscribers"), id);

        batch.set(docRef, {
          ...subscriberData,
          importedAt: new Date().toISOString(),
          migratedFrom: "clinic-418813",
        });
      });

      console.log(`💾 Writing batch to database...`);
      await batch.commit();
      imported += batchIds.length;

      console.log(
        `✅ Imported ${imported}/${subscriberIds.length} subscribers`
      );
    }

    console.log("🎉 Import completed successfully!");
    console.log(`📈 Total imported: ${imported} newsletter subscribers`);

    // Show sample of imported data
    console.log("\n📋 Sample imported data:");
    const sampleId = subscriberIds[0];
    console.log(JSON.stringify(data[sampleId], null, 2));
  } catch (error) {
    console.error("❌ Import failed:", error);

    if (error.code === "permission-denied") {
      console.log("\n🔒 Permission denied. This might be because:");
      console.log("1. Firestore security rules don't allow writes");
      console.log("2. You need to be authenticated");
      console.log("3. Insufficient permissions");
    }

    throw error;
  }
}

importNewsletterSubscribers()
  .then(() => {
    console.log("🎉 Import process completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Import process failed:", error.message);
    process.exit(1);
  });
