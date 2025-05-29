// Simple migration script using Firebase REST API
// No service account keys needed - just uses your browser authentication

console.log("🚀 Starting simple newsletter migration...");

// Your Firebase project IDs
const OLD_PROJECT_ID = "clinic-418813";
const NEW_PROJECT_ID = "gioia-beauty";

async function exportFromOldProject() {
  console.log("📤 Step 1: Export data from old project");
  console.log("👆 Please follow these steps:");
  console.log("");
  console.log(
    "1. Go to: https://console.firebase.google.com/project/" +
      OLD_PROJECT_ID +
      "/firestore/data"
  );
  console.log('2. Navigate to the "newsletter_subscribers" collection');
  console.log(
    "3. Click the export button (three dots menu) and export to JSON"
  );
  console.log(
    '4. Save the file as "newsletter_subscribers_export.json" in this scripts folder'
  );
  console.log("");
  console.log("📋 Or alternatively, use Firebase CLI:");
  console.log("   firebase auth:login");
  console.log("   firebase use " + OLD_PROJECT_ID);
  console.log(
    "   firebase firestore:export ./backup --collection-ids newsletter_subscribers"
  );
  console.log("");

  // Check if export file exists
  try {
    const fs = await import("fs");
    if (fs.existsSync("./scripts/newsletter_subscribers_export.json")) {
      console.log("✅ Export file found!");
      return true;
    } else {
      console.log("❌ Export file not found. Please export the data first.");
      return false;
    }
  } catch (error) {
    console.log(
      "📥 Please export the newsletter_subscribers collection and save as newsletter_subscribers_export.json"
    );
    return false;
  }
}

async function importToNewProject() {
  console.log("📥 Step 2: Import data to new project");

  try {
    const fs = await import("fs");
    const data = JSON.parse(
      fs.readFileSync("./scripts/newsletter_subscribers_export.json", "utf8")
    );

    console.log(`📊 Found ${Object.keys(data).length} subscribers to migrate`);

    // Convert to array format for easier processing
    const subscribers = Object.entries(data).map(([id, doc]) => ({
      id,
      ...doc,
      migratedAt: new Date().toISOString(),
      originalId: id,
    }));

    console.log("📋 Ready to import. Please follow these steps:");
    console.log("");
    console.log(
      "1. Go to: https://console.firebase.google.com/project/" +
        NEW_PROJECT_ID +
        "/firestore/data"
    );
    console.log(
      '2. Create a collection called "newsletter_subscribers" if it doesn\'t exist'
    );
    console.log("3. Use Firebase CLI to import:");
    console.log("   firebase use " + NEW_PROJECT_ID);
    console.log("   firebase firestore:import ./backup");
    console.log("");
    console.log(
      "📄 Or manually copy the data from newsletter_subscribers_export.json"
    );

    return subscribers;
  } catch (error) {
    console.error("❌ Failed to read export file:", error.message);
    return null;
  }
}

async function main() {
  console.log("📋 Newsletter Subscribers Migration Tool");
  console.log("=====================================");
  console.log("");

  // Step 1: Export
  const exportReady = await exportFromOldProject();

  if (!exportReady) {
    console.log("⚠️ Please complete the export step first");
    return;
  }

  // Step 2: Import
  const subscribers = await importToNewProject();

  if (subscribers) {
    console.log("");
    console.log("🎉 Migration preparation complete!");
    console.log(
      `📊 Ready to migrate ${subscribers.length} newsletter subscribers`
    );
    console.log("");
    console.log("📋 Summary of what will be migrated:");

    // Show sample of data
    if (subscribers.length > 0) {
      console.log("Sample subscriber data:");
      console.log(JSON.stringify(subscribers[0], null, 2));
    }
  }
}

main().catch(console.error);
