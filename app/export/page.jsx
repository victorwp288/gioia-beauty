"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db, collections } from "@/lib/firebase/config";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Download, Database, AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";

// Helper function to convert Firestore data to JSON-serializable format
function serializeFirestoreData(data) {
  if (data === null || data === undefined) {
    return data;
  }

  if (data.toDate && typeof data.toDate === "function") {
    // Firestore Timestamp
    return data.toDate().toISOString();
  }

  if (data instanceof Date) {
    return data.toISOString();
  }

  if (Array.isArray(data)) {
    return data.map(serializeFirestoreData);
  }

  if (typeof data === "object") {
    const serialized = {};
    for (const [key, value] of Object.entries(data)) {
      serialized[key] = serializeFirestoreData(value);
    }
    return serialized;
  }

  return data;
}

export default function DatabaseExport() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);
  const [exportStats, setExportStats] = useState(null);

  useEffect(() => {
    console.log("🔐 Export Page: Setting up auth state listener...");

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log(
        "🔐 Export Page: Auth state changed:",
        user ? { uid: user.uid, email: user.email } : "No user"
      );

      setUser(user);
      setAuthLoading(false);

      if (!user) {
        console.log("🔐 Export Page: No user found, redirecting to login...");
        router.replace("/login");
      } else {
        console.log("✅ Export Page: User authenticated");
      }
    });

    return () => {
      console.log("🔐 Export Page: Cleaning up auth listener");
      unsubscribe();
    };
  }, [router]);

  const handleExport = async () => {
    setIsExporting(true);
    setExportStatus(null);
    setExportStats(null);

    try {
      console.log("🔐 Starting database export...");

      const exportData = {
        exportInfo: {
          timestamp: new Date().toISOString(),
          projectId: "gioia-beauty-b95e0",
          exportedBy: user?.email || "unknown",
          collections: Object.values(collections),
        },
        data: {},
      };

      let totalDocuments = 0;
      const collectionStats = {};

      // Export customers collection
      try {
        console.log("📊 Exporting customers collection...");
        const customersSnapshot = await getDocs(
          query(
            collection(db, collections.CUSTOMERS),
            orderBy("createdAt", "desc")
          )
        );

        exportData.data.customers = customersSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...serializeFirestoreData(doc.data()),
        }));

        const customersCount = customersSnapshot.docs.length;
        totalDocuments += customersCount;
        collectionStats.customers = customersCount;
        console.log(`✅ Exported ${customersCount} customer documents`);
      } catch (error) {
        console.error("❌ Error exporting customers:", error);
        exportData.data.customers = [];
        collectionStats.customers = 0;
      }

      // Export vacations collection
      try {
        console.log("📊 Exporting vacations collection...");
        const vacationsSnapshot = await getDocs(
          query(
            collection(db, collections.VACATIONS),
            orderBy("startDate", "desc")
          )
        );

        exportData.data.vacations = vacationsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...serializeFirestoreData(doc.data()),
        }));

        const vacationsCount = vacationsSnapshot.docs.length;
        totalDocuments += vacationsCount;
        collectionStats.vacations = vacationsCount;
        console.log(`✅ Exported ${vacationsCount} vacation documents`);
      } catch (error) {
        console.error("❌ Error exporting vacations:", error);
        exportData.data.vacations = [];
        collectionStats.vacations = 0;
      }

      // Export newsletter subscribers collection
      try {
        console.log("📊 Exporting newsletter subscribers collection...");
        const subscribersSnapshot = await getDocs(
          query(
            collection(db, collections.NEWSLETTER_SUBSCRIBERS),
            orderBy("subscribedAt", "desc")
          )
        );

        exportData.data.newsletter_subscribers = subscribersSnapshot.docs.map(
          (doc) => ({
            id: doc.id,
            ...serializeFirestoreData(doc.data()),
          })
        );

        const subscribersCount = subscribersSnapshot.docs.length;
        totalDocuments += subscribersCount;
        collectionStats.newsletter_subscribers = subscribersCount;
        console.log(
          `✅ Exported ${subscribersCount} newsletter subscriber documents`
        );
      } catch (error) {
        console.error("❌ Error exporting newsletter subscribers:", error);
        exportData.data.newsletter_subscribers = [];
        collectionStats.newsletter_subscribers = 0;
      }

      // Export settings collection (if it exists)
      try {
        console.log("📊 Exporting settings collection...");
        const settingsSnapshot = await getDocs(
          collection(db, collections.SETTINGS)
        );

        exportData.data.settings = settingsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...serializeFirestoreData(doc.data()),
        }));

        const settingsCount = settingsSnapshot.docs.length;
        totalDocuments += settingsCount;
        collectionStats.settings = settingsCount;
        console.log(`✅ Exported ${settingsCount} settings documents`);
      } catch (error) {
        console.error("❌ Error exporting settings:", error);
        exportData.data.settings = [];
        collectionStats.settings = 0;
      }

      // Export analytics collection (if it exists)
      try {
        console.log("📊 Exporting analytics collection...");
        const analyticsSnapshot = await getDocs(
          collection(db, collections.ANALYTICS)
        );

        exportData.data.analytics = analyticsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...serializeFirestoreData(doc.data()),
        }));

        const analyticsCount = analyticsSnapshot.docs.length;
        totalDocuments += analyticsCount;
        collectionStats.analytics = analyticsCount;
        console.log(`✅ Exported ${analyticsCount} analytics documents`);
      } catch (error) {
        console.error("❌ Error exporting analytics:", error);
        exportData.data.analytics = [];
        collectionStats.analytics = 0;
      }

      // Update export metadata
      exportData.exportInfo.totalDocuments = totalDocuments;
      exportData.exportInfo.collectionsExported = Object.keys(
        exportData.data
      ).length;

      // Create and download the file
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename = `gioia_beauty_db_export_${
        new Date().toISOString().split("T")[0]
      }.json`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setExportStats({
        totalDocuments,
        collections: collectionStats,
        filename,
      });

      setExportStatus({
        type: "success",
        message: `Database exported successfully! Downloaded: ${filename}`,
      });

      console.log(`🎉 Database export completed!`);
      console.log(`📊 Total documents exported: ${totalDocuments}`);
    } catch (error) {
      console.error("❌ Database export failed:", error);
      setExportStatus({
        type: "error",
        message: error.message || "Failed to export database",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            Checking authentication...
          </p>
        </div>
      </div>
    );
  }

  // Show redirect message if no user (will redirect to login)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-300">
            Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pt-20 pb-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          {/* Back Button */}
          <div className="mb-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="inline-flex items-center space-x-2 px-4 py-2 border-2 border-blue-500 rounded-md text-sm font-medium text-blue-600 bg-white hover:bg-blue-50 transition-colors shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </button>
          </div>

          {/* Page Title */}
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Database Export
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-300">
              Export your Firebase database to JSON format
            </p>
          </div>
        </div>

        {/* Main Export Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex items-start space-x-6">
            <div className="flex-shrink-0">
              <Database className="w-12 h-12 text-blue-600 dark:text-blue-400" />
            </div>

            <div className="flex-1">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
                Export Gioia Beauty Database
              </h2>

              <p className="text-gray-600 dark:text-gray-300 mb-6">
                This will export all data from your Firebase database including
                customer appointments, vacation periods, newsletter subscribers,
                and system settings to a downloadable JSON file.
              </p>

              {/* Warning notice */}
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                      Sensitive Data Export
                    </p>
                    <p className="text-yellow-700 dark:text-yellow-400">
                      This export contains sensitive customer information
                      including names, emails, phone numbers, and appointment
                      details. Handle the exported file securely and in
                      compliance with data protection regulations.
                    </p>
                  </div>
                </div>
              </div>

              {/* Export Button */}
              <div className="mb-6">
                <Button
                  onClick={handleExport}
                  disabled={isExporting}
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  {isExporting ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                      Exporting Database...
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5 mr-3" />
                      Export Database to JSON
                    </>
                  )}
                </Button>
              </div>

              {/* Status messages */}
              {exportStatus && (
                <div
                  className={`mb-6 p-4 rounded-lg ${
                    exportStatus.type === "success"
                      ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300"
                      : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300"
                  }`}
                >
                  <p className="font-medium">{exportStatus.message}</p>
                </div>
              )}

              {/* Export Statistics */}
              {exportStats && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                  <h3 className="font-medium text-blue-800 dark:text-blue-300 mb-2">
                    Export Summary
                  </h3>
                  <div className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
                    <p>
                      <strong>Total Documents:</strong>{" "}
                      {exportStats.totalDocuments}
                    </p>
                    <p>
                      <strong>Filename:</strong> {exportStats.filename}
                    </p>
                    <div className="mt-2">
                      <strong>Collections exported:</strong>
                      <ul className="list-disc list-inside ml-4 mt-1">
                        {Object.entries(exportStats.collections).map(
                          ([collection, count]) => (
                            <li key={collection}>
                              {collection.replace("_", " ")}: {count} documents
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Export info */}
              <div className="text-sm text-gray-500 dark:text-gray-400">
                <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Export includes:
                </h3>
                <ul className="list-disc list-inside space-y-1">
                  <li>Customer appointments and personal information</li>
                  <li>Vacation periods and business closures</li>
                  <li>Newsletter subscribers and preferences</li>
                  <li>All document metadata and timestamps</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* User Info */}
        <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Logged in as: <span className="font-medium">{user?.email}</span>
        </div>
      </div>
    </div>
  );
}
