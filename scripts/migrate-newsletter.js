// Migration script to copy newsletter_subscribers from old Firebase to new Firebase
// Using Firebase Admin SDK for better Node.js compatibility

import admin from "firebase-admin";

// You'll need to download service account keys from both Firebase projects
// 1. Go to Firebase Console > Project Settings > Service Accounts
// 2. Click "Generate new private key" and download the JSON file
// 3. Place the old project key as 'old-firebase-key.json'
// 4. Place the new project key as 'new-firebase-key.json'

console.log("🚀 Starting newsletter subscribers migration...");

async function migrateNewsletterSubscribers() {
  try {
    // Initialize old Firebase app
    const oldApp = admin.initializeApp(
      {
        credential: admin.credential.cert("./old-firebase-key.json"),
        // You can also set databaseURL if needed
      },
      "oldApp"
    );

    // Initialize new Firebase app
    const newApp = admin.initializeApp(
      {
        credential: admin.credential.cert("./new-firebase-key.json"),
        // You can also set databaseURL if needed
      },
      "newApp"
    );

    const oldDb = admin.firestore(oldApp);
    const newDb = admin.firestore(newApp);

    console.log("📡 Fetching newsletter subscribers from old database...");

    // Get all documents from old newsletter_subscribers collection
    const oldCollection = oldDb.collection("newsletter_subscribers");
    const snapshot = await oldCollection.get();

    if (snapshot.empty) {
      console.log("📭 No newsletter subscribers found in old database");
      return;
    }

    console.log(`📊 Found ${snapshot.size} newsletter subscribers to migrate`);

    // Prepare batch operations for new database
    const newCollection = newDb.collection("newsletter_subscribers");
    const batchSize = 500; // Firestore batch limit
    let totalMigrated = 0;
    let batch = newDb.batch();
    let operationCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const docRef = newCollection.doc(doc.id);

      // Add to batch
      batch.set(docRef, {
        ...data,
        migratedAt: new Date().toISOString(),
        originalId: doc.id,
      });

      operationCount++;

      // Execute batch when we reach the limit
      if (operationCount >= batchSize) {
        console.log(`💾 Writing batch of ${operationCount} documents...`);
        await batch.commit();
        totalMigrated += operationCount;

        // Create new batch
        batch = newDb.batch();
        operationCount = 0;

        console.log(
          `✅ Migrated ${totalMigrated}/${snapshot.size} subscribers`
        );
      }
    }

    // Execute remaining batch
    if (operationCount > 0) {
      console.log(`💾 Writing final batch of ${operationCount} documents...`);
      await batch.commit();
      totalMigrated += operationCount;
    }

    console.log(
      `🎉 Migration completed! Total migrated: ${totalMigrated} newsletter subscribers`
    );

    // Verify migration
    const newSnapshot = await newCollection.get();
    console.log(
      `✅ Verification: New database now has ${newSnapshot.size} newsletter subscribers`
    );
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

// Alternative method using simple config objects instead of service account files
async function migrateWithConfig() {
  try {
    // If you prefer not to use service account files, you can use config objects
    // But you'll need to set GOOGLE_APPLICATION_CREDENTIALS environment variable

    const oldApp = admin.initializeApp(
      {
        projectId: "your-old-project-id",
      },
      "oldConfigApp"
    );

    const newApp = admin.initializeApp(
      {
        projectId: "your-new-project-id",
      },
      "newConfigApp"
    );

    // Rest of the logic is the same...
    console.log("📋 Using config-based initialization...");
    // You can copy the logic from migrateNewsletterSubscribers here
  } catch (error) {
    console.error("❌ Config-based migration failed:", error);
  }
}

// Run the migration
try {
  await migrateNewsletterSubscribers();
  process.exit(0);
} catch (error) {
  console.error("💥 Script failed:", error.message);
  console.log("\n📋 Setup Instructions:");
  console.log("1. Download service account keys from both Firebase projects");
  console.log(
    '2. Place them as "old-firebase-key.json" and "new-firebase-key.json"'
  );
  console.log("3. Run the script again");
  process.exit(1);
}
