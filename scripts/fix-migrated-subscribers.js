// Script to fix migrated newsletter subscribers data structure
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
} from "firebase/firestore";

// New Firebase config
const newFirebaseConfig = {
  apiKey: "AIzaSyDwLTiswkZu6B5h7sOmQC_Tsr8hAYvVDuw",
  authDomain: "gioia-beauty-2d043.firebaseapp.com",
  projectId: "gioia-beauty-2d043",
  storageBucket: "gioia-beauty-2d043.firebasestorage.app",
  messagingSenderId: "875570946221",
  appId: "1:875570946221:web:fd73a8e856cde6bb726624",
};

console.log("🔧 Starting migrated subscribers data fix...");

async function fixMigratedSubscribers() {
  try {
    // Initialize Firebase app
    const app = initializeApp(newFirebaseConfig, "fix-app");
    const db = getFirestore(app);

    console.log("📖 Reading current newsletter subscribers...");
    const collectionRef = collection(db, "newsletter_subscribers");
    const snapshot = await getDocs(collectionRef);

    if (snapshot.empty) {
      console.log("📭 No newsletter subscribers found");
      return;
    }

    console.log(`📊 Found ${snapshot.docs.length} subscribers to fix`);

    // Analyze current data
    let needsStatusField = 0;
    let needsSubscribedAtNormalization = 0;
    let alreadyFixed = 0;

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (!data.status) needsStatusField++;
      if (data.subscribed_at && !data.subscribedAt)
        needsSubscribedAtNormalization++;
      if (data.status === "active" && data.subscribedAt) alreadyFixed++;
    });

    console.log(`📋 Analysis:`);
    console.log(`   • Need status field: ${needsStatusField}`);
    console.log(
      `   • Need subscribedAt normalization: ${needsSubscribedAtNormalization}`
    );
    console.log(`   • Already fixed: ${alreadyFixed}`);

    if (needsStatusField === 0 && needsSubscribedAtNormalization === 0) {
      console.log("✅ All subscribers already have correct structure!");
      return;
    }

    // Fix using batches (Firestore limit is 500 operations per batch)
    const batchSize = 500;
    let fixed = 0;

    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
      const batch = writeBatch(db);
      const batchDocs = snapshot.docs.slice(i, i + batchSize);

      console.log(
        `📦 Processing batch ${Math.floor(i / batchSize) + 1} with ${
          batchDocs.length
        } subscribers...`
      );

      batchDocs.forEach((docSnapshot) => {
        const currentData = docSnapshot.data();
        const docRef = doc(collectionRef, docSnapshot.id);

        // Check if this document needs fixing
        const needsStatus = !currentData.status;
        const needsDateNormalization =
          currentData.subscribed_at && !currentData.subscribedAt;

        if (needsStatus || needsDateNormalization) {
          const updatedData = {
            ...currentData,
          };

          // Add missing status field
          if (needsStatus) {
            updatedData.status = "active";
          }

          // Normalize date fields
          if (needsDateNormalization) {
            updatedData.subscribedAt = currentData.subscribed_at;
            // Keep original subscribed_at for compatibility
          }

          // Add normalized createdAt if missing
          if (!updatedData.createdAt) {
            updatedData.createdAt =
              updatedData.subscribedAt ||
              updatedData.subscribed_at ||
              new Date().toISOString();
          }

          // Add updatedAt timestamp
          updatedData.updatedAt = new Date().toISOString();
          updatedData.fixedAt = new Date().toISOString();

          batch.update(docRef, updatedData);
          fixed++;
        }
      });

      if (
        batchDocs.some((doc) => {
          const data = doc.data();
          return !data.status || (data.subscribed_at && !data.subscribedAt);
        })
      ) {
        console.log(`💾 Writing batch to database...`);
        await batch.commit();
        console.log(`✅ Fixed ${fixed} subscribers so far...`);
      }
    }

    console.log("🎉 Fix completed successfully!");
    console.log(`📈 Total fixed: ${fixed} newsletter subscribers`);

    // Verify the fix
    console.log("🔍 Verifying fix...");
    const verifySnapshot = await getDocs(collectionRef);
    const withStatus = verifySnapshot.docs.filter(
      (doc) => doc.data().status
    ).length;
    const withSubscribedAt = verifySnapshot.docs.filter(
      (doc) => doc.data().subscribedAt
    ).length;

    console.log(`✅ Verification:`);
    console.log(
      `   • Subscribers with status: ${withStatus}/${verifySnapshot.docs.length}`
    );
    console.log(
      `   • Subscribers with subscribedAt: ${withSubscribedAt}/${verifySnapshot.docs.length}`
    );

    if (withStatus === verifySnapshot.docs.length) {
      console.log("🎯 All subscribers now have the correct status field!");
      console.log(
        "📋 Your dashboard should now show the subscribers properly."
      );
    }
  } catch (error) {
    console.error("❌ Fix failed:", error);
    throw error;
  }
}

fixMigratedSubscribers()
  .then(() => {
    console.log("🎉 Fix process completed successfully!");
    console.log("");
    console.log("🎯 Next steps:");
    console.log(
      "1. Go to http://localhost:3000/debug-subscribers to verify the fix"
    );
    console.log("2. Check your dashboard - subscribers should now appear!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Fix process failed:", error.message);
    process.exit(1);
  });
