"use client";
import React, { useState } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc } from "firebase/firestore";

// Old Firebase config
const oldFirebaseConfig = {
  apiKey: "AIzaSyAuWwmKaTpYR4AlGaRo1CXDkUb_XlaOinU",
  authDomain: "clinic-418813.firebaseapp.com",
  projectId: "clinic-418813",
  storageBucket: "clinic-418813.firebasestorage.app",
  messagingSenderId: "988012998371",
  appId: "1:988012998371:web:85f7ca36a9154e3c799fd6",
  measurementId: "G-5HM2L5RPHD",
};

// New Firebase config
const newFirebaseConfig = {
  apiKey: "AIzaSyByq0llhuTY-_7eXnpknyPqU38IvQajcI0",
  authDomain: "gioia-beauty-b95e0.firebaseapp.com",
  projectId: "gioia-beauty-b95e0",
  storageBucket: "gioia-beauty-b95e0.firebasestorage.app",
  messagingSenderId: "123049235831",
  appId: "1:123049235831:web:2b07ab53e1aa8d676afd72",
};

export default function ExportDataPage() {
  const [status, setStatus] = useState("");
  const [exportedData, setExportedData] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixStatus, setFixStatus] = useState("");
  const [vacationData, setVacationData] = useState(null);
  const [vacationStatus, setVacationStatus] = useState("");
  const [vacationLogs, setVacationLogs] = useState([]);

  // Appointment migration state
  const [appointmentData, setAppointmentData] = useState(null);
  const [appointmentStatus, setAppointmentStatus] = useState("");
  const [appointmentLogs, setAppointmentLogs] = useState([]);
  const [appointmentPreview, setAppointmentPreview] = useState(null);
  const [appointmentStats, setAppointmentStats] = useState(null);

  const exportNewsletterSubscribers = async () => {
    try {
      setStatus("🚀 Starting export from old Firebase...");

      // Initialize old Firebase app
      const oldApp = initializeApp(oldFirebaseConfig, "old-export");
      const oldDb = getFirestore(oldApp);

      setStatus("📡 Fetching newsletter subscribers...");

      // Get newsletter_subscribers collection
      const collectionRef = collection(oldDb, "newsletter_subscribers");
      const snapshot = await getDocs(collectionRef);

      if (snapshot.empty) {
        setStatus("📭 No newsletter subscribers found");
        return;
      }

      setStatus(`📊 Found ${snapshot.docs.length} subscribers`);

      // Convert to exportable format
      const subscribers = {};
      snapshot.docs.forEach((doc) => {
        subscribers[doc.id] = {
          ...doc.data(),
          exportedAt: new Date().toISOString(),
          originalId: doc.id,
        };
      });

      setExportedData(subscribers);
      setStatus(
        `✅ Export completed! ${snapshot.docs.length} subscribers ready for import`
      );
    } catch (error) {
      console.error("Export failed:", error);
      if (error.code === "permission-denied") {
        setStatus("❌ Permission denied - check Firestore security rules");
      } else {
        setStatus(`❌ Export failed: ${error.message}`);
      }
    }
  };

  const importToNewFirebase = async () => {
    if (!exportedData) {
      setImportStatus("❌ No data to import - export first");
      return;
    }

    try {
      setImporting(true);
      setImportStatus("🚀 Starting import to new Firebase...");

      // Initialize new Firebase app
      const newApp = initializeApp(newFirebaseConfig, "new-import");
      const newDb = getFirestore(newApp);

      const subscriberIds = Object.keys(exportedData);
      setImportStatus(`📦 Importing ${subscriberIds.length} subscribers...`);

      // Import using batches
      const { writeBatch, doc } = await import("firebase/firestore");
      const batchSize = 500;
      let imported = 0;

      for (let i = 0; i < subscriberIds.length; i += batchSize) {
        const batch = writeBatch(newDb);
        const batchIds = subscriberIds.slice(i, i + batchSize);

        setImportStatus(
          `📦 Processing batch ${Math.floor(i / batchSize) + 1}...`
        );

        batchIds.forEach((id) => {
          const subscriberData = exportedData[id];
          const docRef = doc(collection(newDb, "newsletter_subscribers"), id);

          batch.set(docRef, {
            ...subscriberData,
            importedAt: new Date().toISOString(),
            migratedFrom: "clinic-418813",
          });
        });

        await batch.commit();
        imported += batchIds.length;

        setImportStatus(
          `✅ Imported ${imported}/${subscriberIds.length} subscribers`
        );
      }

      setImportStatus(
        `🎉 Import completed! ${imported} subscribers migrated successfully`
      );
    } catch (error) {
      console.error("Import failed:", error);
      setImportStatus(`❌ Import failed: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const fixMigratedSubscribers = async () => {
    try {
      setFixing(true);
      setFixStatus("🔧 Starting subscriber data fix...");

      // Initialize new Firebase app (reuse existing config)
      const fixApp = initializeApp(newFirebaseConfig, "fix-subscribers");
      const fixDb = getFirestore(fixApp);

      setFixStatus("📖 Reading current newsletter subscribers...");

      const collectionRef = collection(fixDb, "newsletter_subscribers");
      const snapshot = await getDocs(collectionRef);

      if (snapshot.empty) {
        setFixStatus("📭 No newsletter subscribers found");
        return;
      }

      setFixStatus(
        `📊 Found ${snapshot.docs.length} subscribers to analyze...`
      );

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

      setFixStatus(
        `📋 Analysis: Need status: ${needsStatusField}, Need date norm: ${needsSubscribedAtNormalization}, Already fixed: ${alreadyFixed}`
      );

      if (needsStatusField === 0 && needsSubscribedAtNormalization === 0) {
        setFixStatus("✅ All subscribers already have correct structure!");
        return;
      }

      setFixStatus("🔧 Applying fixes...");

      // Fix using batches
      const { writeBatch } = await import("firebase/firestore");
      const batchSize = 500;
      let fixed = 0;

      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = writeBatch(fixDb);
        const batchDocs = snapshot.docs.slice(i, i + batchSize);

        setFixStatus(`📦 Processing batch ${Math.floor(i / batchSize) + 1}...`);

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
            }

            // Add normalized createdAt if missing
            if (!updatedData.createdAt) {
              updatedData.createdAt =
                updatedData.subscribedAt ||
                updatedData.subscribed_at ||
                new Date().toISOString();
            }

            // Add timestamps
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
          await batch.commit();
          setFixStatus(`✅ Fixed ${fixed} subscribers so far...`);
        }
      }

      setFixStatus(`🎉 Fix completed! Fixed ${fixed} subscribers total`);

      // Verify the fix
      setFixStatus("🔍 Verifying fix...");
      const verifySnapshot = await getDocs(collectionRef);
      const withStatus = verifySnapshot.docs.filter(
        (doc) => doc.data().status
      ).length;

      setFixStatus(
        `✅ Success! ${withStatus}/${verifySnapshot.docs.length} subscribers now have status field. Dashboard should work now!`
      );
    } catch (error) {
      console.error("Fix failed:", error);
      setFixStatus(`❌ Fix failed: ${error.message}`);
    } finally {
      setFixing(false);
    }
  };

  const downloadJson = () => {
    if (!exportedData) return;

    const dataStr = JSON.stringify(exportedData, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "newsletter_subscribers_export.json";
    link.click();

    URL.revokeObjectURL(url);
  };

  const exportVacations = async () => {
    setVacationStatus("Exporting vacations from old project...");
    setVacationLogs([]);

    try {
      // Initialize Firebase for old project
      const { initializeApp } = await import("firebase/app");
      const { getFirestore, collection, getDocs } = await import(
        "firebase/firestore"
      );

      const oldFirebaseConfig = {
        apiKey: "AIzaSyDrz0cInrOfn1HmLLVnYd9i-q4VVRgqzTc",
        authDomain: "clinic-418813.firebaseapp.com",
        projectId: "clinic-418813",
        storageBucket: "clinic-418813.appspot.com",
        messagingSenderId: "295323077087",
        appId: "1:295323077087:web:b36a96b52e8b68b1e51e40",
      };

      // Initialize app with unique name
      const oldApp = initializeApp(oldFirebaseConfig, "old-clinic-vacations");
      const oldDb = getFirestore(oldApp);

      setVacationLogs((prev) => [
        ...prev,
        "🔍 Connected to old project database...",
      ]);

      // Get all vacation documents
      const vacationsRef = collection(oldDb, "vactions"); // Note: "vactions" as per your spelling
      const snapshot = await getDocs(vacationsRef);

      setVacationLogs((prev) => [
        ...prev,
        `📊 Found ${snapshot.docs.length} vacation periods`,
      ]);

      const vacations = [];
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const vacation = {
          id: doc.id,
          ...data,
          exportedAt: new Date().toISOString(),
        };
        vacations.push(vacation);

        setVacationLogs((prev) => [
          ...prev,
          `📅 Vacation: ${vacation.startDate} to ${vacation.endDate}`,
        ]);
      });

      setVacationData(vacations);
      setVacationStatus(
        `✅ Exported ${vacations.length} vacation periods successfully!`
      );

      setVacationLogs((prev) => [
        ...prev,
        "✅ Export completed!",
        "📋 Review the data below and click 'Import to New Project' when ready",
      ]);
    } catch (error) {
      console.error("❌ Export error:", error);
      setVacationStatus(`❌ Export failed: ${error.message}`);
      setVacationLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
    }
  };

  const importVacationsToNewProject = async () => {
    if (!vacationData) {
      alert("No vacation data to import. Please export first.");
      return;
    }

    setVacationStatus("Importing vacations to new project...");

    try {
      const { collection, addDoc, writeBatch, doc } = await import(
        "firebase/firestore"
      );
      const { db } = await import("@/lib/firebase/config");

      setVacationLogs((prev) => [
        ...prev,
        "🔍 Connected to new project database...",
      ]);

      // Create batch for efficient writes
      const batch = writeBatch(db);
      const vacationsRef = collection(db, "vacation_periods");

      setVacationLogs((prev) => [
        ...prev,
        `📦 Preparing batch import of ${vacationData.length} vacations...`,
      ]);

      const transformedVacations = [];

      for (const oldVacation of vacationData) {
        // Transform the data structure
        const transformedVacation = {
          // Keep the original dates (they're already in ISO format)
          startDate: oldVacation.startDate,
          endDate: oldVacation.endDate,

          // Transform createdAt or use current time if missing
          createdAt: oldVacation.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(), // Always current time for migration

          // Add default reason since old system didn't have this field
          reason: "Migrated Vacation Period",

          // Add migration metadata
          migratedFrom: "clinic-418813",
          originalId: oldVacation.id,
          importedAt: new Date().toISOString(),
          exportedAt: oldVacation.exportedAt,
        };

        // Create new document reference
        const newDocRef = doc(vacationsRef);
        batch.set(newDocRef, transformedVacation);

        transformedVacations.push({
          id: newDocRef.id,
          ...transformedVacation,
        });

        setVacationLogs((prev) => [
          ...prev,
          `✅ Prepared: ${transformedVacation.startDate.split("T")[0]} to ${
            transformedVacation.endDate.split("T")[0]
          }`,
        ]);
      }

      setVacationLogs((prev) => [...prev, "💾 Committing batch write..."]);

      // Commit the batch
      await batch.commit();

      setVacationStatus(
        `✅ Successfully imported ${transformedVacations.length} vacation periods!`
      );
      setVacationLogs((prev) => [
        ...prev,
        "🎉 Import completed successfully!",
        "🔄 Vacation periods are now available in your new system",
        "📊 You can view them in the Dashboard > Imposta break",
      ]);
    } catch (error) {
      console.error("❌ Import error:", error);
      setVacationStatus(`❌ Import failed: ${error.message}`);
      setVacationLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
    }
  };

  const transformAppointmentData = (oldAppointment) => {
    const errors = [];

    // Helper function to normalize appointment types to match the new system
    const normalizeAppointmentType = (type) => {
      if (!type) return "Altro";

      // Map specific Italian services to categories
      const typeMapping = {
        // Nail services
        "applicazione smalto classico": "Manicure",
        "applicazione smalto": "Manicure",
        manicure: "Manicure",
        pedicure: "Pedicure",

        // Eye treatments
        "laminazione ciglia": "Trattamento Viso",
        "extension ciglia": "Trattamento Viso",
        "tinta ciglia": "Trattamento Viso",

        // Hair removal
        ceretta: "Depilazione",
        depilazione: "Depilazione",
        "ceretta inguine": "Depilazione",

        // Face treatments
        "trattamento viso": "Trattamento Viso",
        "pulizia viso": "Trattamento Viso",
        "idratazione viso": "Trattamento Viso",

        // Body treatments
        "trattamento corpo": "Trattamento Corpo",
        massaggio: "Massaggio",

        // Makeup
        trucco: "Trucco",
        makeup: "Trucco",

        // Consultation
        consultazione: "Consultazione",
        consultation: "Consultazione",
        consulenza: "Consultazione",
      };

      const normalized = typeMapping[type.toLowerCase()] || "Altro";

      // Validate against allowed types in new system
      const allowedTypes = [
        "Consultazione",
        "Trattamento Viso",
        "Trattamento Corpo",
        "Massaggio",
        "Depilazione",
        "Manicure",
        "Pedicure",
        "Trucco",
        "Altro",
      ];

      return allowedTypes.includes(normalized) ? normalized : "Altro";
    };

    // Helper function to normalize dates - handle both selectedDate string and date timestamp
    const normalizeDate = (appointment) => {
      // Try selectedDate first (string format YYYY-MM-DD)
      if (appointment.selectedDate) {
        try {
          const date = new Date(appointment.selectedDate + "T00:00:00");
          if (!isNaN(date.getTime())) {
            // Return ISO string format to match new appointment storage
            return date.toISOString();
          }
        } catch (error) {
          // Continue to try other formats
        }
      }

      // Try date field (Firestore timestamp)
      if (appointment.date) {
        try {
          let date;
          if (appointment.date?.toDate) {
            date = appointment.date.toDate();
          } else if (appointment.date?.seconds) {
            date = new Date(appointment.date.seconds * 1000);
          } else if (typeof appointment.date === "string") {
            date = new Date(appointment.date);
          } else {
            date = new Date(appointment.date);
          }

          if (!isNaN(date.getTime())) {
            // Return ISO string format to match new appointment storage
            return date.toISOString();
          }
        } catch (error) {
          // Continue to try other formats
        }
      }

      return null;
    };

    // Helper function to normalize duration (handle both string and number)
    const normalizeDuration = (duration) => {
      if (!duration) return 60; // Default fallback

      if (typeof duration === "string") {
        const parsed = parseInt(duration, 10);
        return isNaN(parsed) ? 60 : parsed;
      }

      if (typeof duration === "number") {
        return duration;
      }

      return 60; // Default fallback
    };

    // Helper function to normalize time (use startTime, fallback to timeSlot)
    const normalizeTime = (appointment) => {
      const time = appointment.startTime || appointment.timeSlot || "";

      if (!time) return null;

      // Validate HH:mm format
      if (typeof time === "string" && time.match(/^\d{1,2}:\d{2}$/)) {
        const [hours, minutes] = time.split(":");
        const h = parseInt(hours, 10);
        const m = parseInt(minutes, 10);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          // Ensure two-digit format
          return `${h.toString().padStart(2, "0")}:${m
            .toString()
            .padStart(2, "0")}`;
        }
      }

      return null;
    };

    // Start transformation
    const transformed = {
      // Core appointment data
      name: (oldAppointment.name || "").trim(),
      email: (oldAppointment.email || "").trim(),
      number: (oldAppointment.number || "").trim(),

      // Service details
      appointmentType: normalizeAppointmentType(oldAppointment.appointmentType),
      duration: normalizeDuration(oldAppointment.duration),

      // Date and time - USE ISO STRING FORMAT like new appointments
      selectedDate: normalizeDate(oldAppointment),
      startTime: normalizeTime(oldAppointment),
      endTime: oldAppointment.endTime || "", // Keep original if present

      // Additional details
      note: (oldAppointment.note || "").trim(),
      status: "confirmed", // Use "confirmed" like new appointments, not "completed"

      // Migration metadata
      migratedFrom: "clinic-418813",
      originalId: oldAppointment.id || "unknown",
      importedAt: new Date().toISOString(),
      exportedAt: oldAppointment.exportedAt,

      // Timestamps - USE ISO STRINGS like new appointments
      createdAt: oldAppointment.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      // Preserve additional fields that might be useful
      ...(oldAppointment.totalDuration && {
        totalDuration: oldAppointment.totalDuration,
      }),
      ...(oldAppointment.variant && { variant: oldAppointment.variant }),
    };

    // Calculate endTime if missing but we have startTime and duration
    if (!transformed.endTime && transformed.startTime && transformed.duration) {
      try {
        const [hours, minutes] = transformed.startTime.split(":");
        const startMinutes = parseInt(hours) * 60 + parseInt(minutes);
        const endMinutes = startMinutes + transformed.duration;
        const endHours = Math.floor(endMinutes / 60);
        const endMins = endMinutes % 60;
        transformed.endTime = `${endHours.toString().padStart(2, "0")}:${endMins
          .toString()
          .padStart(2, "0")}`;
      } catch (error) {
        // Keep empty if calculation fails
      }
    }

    // Validation - be more lenient for historical data
    if (!transformed.name.trim()) {
      // If name is missing or placeholder, skip this record
      if (
        !transformed.name ||
        transformed.name.toLowerCase().includes("no appuntamenti")
      ) {
        errors.push("Invalid appointment: appears to be a placeholder record");
      } else {
        errors.push("Name is required");
      }
    }

    // Email can be empty for old records, but if present should be valid
    if (
      transformed.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(transformed.email)
    ) {
      errors.push("Invalid email format");
    }

    if (!transformed.selectedDate) {
      errors.push("Valid date is required");
    }

    if (!transformed.startTime) {
      errors.push("Valid start time is required");
    }

    return {
      transformed,
      errors,
      isValid: errors.length === 0,
      originalData: oldAppointment, // Keep for debugging
    };
  };

  const importAppointmentsToNewProject = async () => {
    if (!appointmentData) {
      alert("No appointment data to import. Please export first.");
      return;
    }

    setAppointmentStatus("Importing appointments to new project...");

    try {
      const { collection, writeBatch, doc } = await import(
        "firebase/firestore"
      );
      const { db } = await import("@/lib/firebase/config");

      setAppointmentLogs((prev) => [
        ...prev,
        "🔍 Connected to new project database...",
      ]);

      const appointmentsRef = collection(db, "customers");
      const validAppointments = [];

      // Transform and validate
      appointmentData.forEach((oldAppointment) => {
        const result = transformAppointmentData(oldAppointment);
        if (result.isValid) {
          validAppointments.push(result.transformed);
        }
      });

      setAppointmentLogs((prev) => [
        ...prev,
        `📦 Importing ${validAppointments.length} valid appointments...`,
      ]);

      // Import in batches
      const batchSize = 500;
      let imported = 0;

      for (let i = 0; i < validAppointments.length; i += batchSize) {
        const batch = writeBatch(db);
        const batchAppointments = validAppointments.slice(i, i + batchSize);

        batchAppointments.forEach((appointment) => {
          const newDocRef = doc(appointmentsRef);
          batch.set(newDocRef, appointment);
        });

        await batch.commit();
        imported += batchAppointments.length;

        setAppointmentLogs((prev) => [
          ...prev,
          `✅ Imported ${imported}/${validAppointments.length} appointments`,
        ]);
      }

      setAppointmentStatus(
        `🎉 Successfully imported ${imported} appointments!`
      );
    } catch (error) {
      console.error("❌ Import error:", error);
      setAppointmentStatus(`❌ Import failed: ${error.message}`);
    }
  };

  const exportAppointments = async () => {
    setAppointmentStatus("Exporting appointments from old project...");
    setAppointmentLogs([]);
    setAppointmentStats(null);

    try {
      // Initialize Firebase for old project
      const { initializeApp } = await import("firebase/app");
      const { getFirestore, collection, getDocs } = await import(
        "firebase/firestore"
      );

      const oldFirebaseConfig = {
        apiKey: "AIzaSyDrz0cInrOfn1HmLLVnYd9i-q4VVRgqzTc",
        authDomain: "clinic-418813.firebaseapp.com",
        projectId: "clinic-418813",
        storageBucket: "clinic-418813.appspot.com",
        messagingSenderId: "295323077087",
        appId: "1:295323077087:web:b36a96b52e8b68b1e51e40",
      };

      // Initialize app with unique name
      const oldApp = initializeApp(
        oldFirebaseConfig,
        "old-clinic-appointments"
      );
      const oldDb = getFirestore(oldApp);

      setAppointmentLogs((prev) => [
        ...prev,
        "🔍 Connected to old project database...",
      ]);

      // Get all customer documents (which are actually appointments)
      const customersRef = collection(oldDb, "customers");
      const snapshot = await getDocs(customersRef);

      setAppointmentLogs((prev) => [
        ...prev,
        `📊 Found ${snapshot.docs.length} appointment records`,
      ]);

      const appointments = [];
      const formatStats = {
        total: 0,
        formats: {},
        missingFields: {},
        sampleData: [],
      };

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const appointment = {
          id: doc.id,
          ...data,
          exportedAt: new Date().toISOString(),
        };
        appointments.push(appointment);

        // Analyze data formats for migration planning
        formatStats.total++;

        // Track field presence
        Object.keys(data).forEach((field) => {
          if (!formatStats.formats[field]) formatStats.formats[field] = 0;
          formatStats.formats[field]++;
        });

        // Track missing critical fields
        const criticalFields = [
          "name",
          "email",
          "appointmentType",
          "selectedDate",
          "startTime",
        ];
        criticalFields.forEach((field) => {
          if (!data[field]) {
            if (!formatStats.missingFields[field])
              formatStats.missingFields[field] = 0;
            formatStats.missingFields[field]++;
          }
        });

        // Keep first 5 records as samples
        if (formatStats.sampleData.length < 5) {
          formatStats.sampleData.push({
            id: doc.id,
            fields: Object.keys(data),
            data: data,
          });
        }

        if (appointments.length % 100 === 0) {
          setAppointmentLogs((prev) => [
            ...prev,
            `📅 Processed ${appointments.length} appointments...`,
          ]);
        }
      });

      setAppointmentData(appointments);
      setAppointmentStats(formatStats);
      setAppointmentStatus(
        `✅ Exported ${appointments.length} appointment records successfully!`
      );

      setAppointmentLogs((prev) => [
        ...prev,
        "✅ Export completed!",
        `📊 Found ${
          Object.keys(formatStats.formats).length
        } different field types`,
        `⚠️ ${
          Object.keys(formatStats.missingFields).length
        } fields have missing data`,
        "📋 Review the data analysis below before importing",
      ]);
    } catch (error) {
      console.error("❌ Export error:", error);
      setAppointmentStatus(`❌ Export failed: ${error.message}`);
      setAppointmentLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
    }
  };

  const deleteAllAppointments = async () => {
    const confirmed = window.confirm(
      "⚠️ DANGER: This will DELETE ALL appointments from the new database!\n\n" +
        "Are you absolutely sure you want to proceed?\n\n" +
        "This action cannot be undone."
    );

    if (!confirmed) return;

    const doubleConfirmed = window.confirm(
      "🚨 FINAL WARNING: You are about to permanently delete ALL appointment data!\n\n" +
        "Type 'DELETE' in the prompt to confirm this action."
    );

    if (!doubleConfirmed) return;

    const finalConfirm = prompt(
      "Type 'DELETE' exactly to confirm deletion of all appointments:"
    );

    if (finalConfirm !== "DELETE") {
      alert("Deletion cancelled - you must type 'DELETE' exactly.");
      return;
    }

    try {
      setAppointmentStatus("🗑️ Deleting all appointments...");
      setAppointmentLogs((prev) => [
        ...prev,
        "🗑️ Starting deletion process...",
      ]);

      const { collection, getDocs, writeBatch, doc } = await import(
        "firebase/firestore"
      );
      const { db } = await import("@/lib/firebase/config");

      const appointmentsRef = collection(db, "customers");
      const snapshot = await getDocs(appointmentsRef);

      setAppointmentLogs((prev) => [
        ...prev,
        `📊 Found ${snapshot.docs.length} appointments to delete`,
      ]);

      if (snapshot.docs.length === 0) {
        setAppointmentStatus("✅ No appointments to delete");
        return;
      }

      // Delete in batches
      const batchSize = 500;
      let deleted = 0;

      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = writeBatch(db);
        const batchDocs = snapshot.docs.slice(i, i + batchSize);

        batchDocs.forEach((docSnapshot) => {
          batch.delete(docSnapshot.ref);
        });

        await batch.commit();
        deleted += batchDocs.length;

        setAppointmentLogs((prev) => [
          ...prev,
          `🗑️ Deleted ${deleted}/${snapshot.docs.length} appointments`,
        ]);
      }

      setAppointmentStatus(`✅ Successfully deleted ${deleted} appointments!`);
      setAppointmentLogs((prev) => [
        ...prev,
        "🎉 Database cleared successfully!",
        "📋 Ready for fresh migration with corrected format",
      ]);
    } catch (error) {
      console.error("❌ Delete error:", error);
      setAppointmentStatus(`❌ Delete failed: ${error.message}`);
      setAppointmentLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          Newsletter Subscribers Migration
        </h1>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Step 1: Export from Old Firebase
          </h2>

          <button
            onClick={exportNewsletterSubscribers}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium mb-4"
          >
            Export Newsletter Subscribers
          </button>

          {status && (
            <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg mb-4">
              <p className="font-mono text-sm text-gray-800 dark:text-gray-200">
                {status}
              </p>
            </div>
          )}

          {exportedData && (
            <div className="mt-4">
              <button
                onClick={downloadJson}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm mr-4"
              >
                📥 Download JSON Backup
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {Object.keys(exportedData).length} subscribers ready
              </span>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Step 2: Import to New Firebase
          </h2>

          <button
            onClick={importToNewFirebase}
            disabled={!exportedData || importing}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-medium mb-4"
          >
            {importing ? "Importing..." : "Import to New Firebase"}
          </button>

          {importStatus && (
            <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg">
              <p className="font-mono text-sm text-gray-800 dark:text-gray-200">
                {importStatus}
              </p>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Step 3: Fix Migrated Data Structure
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
            If subscribers don&apos;t appear in your dashboard, they might be
            missing the required &apos;status&apos; field.
          </p>

          <button
            onClick={fixMigratedSubscribers}
            disabled={fixing}
            className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-medium mb-4"
          >
            {fixing ? "Fixing..." : "Fix Migrated Subscribers"}
          </button>

          {fixStatus && (
            <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg">
              <p className="font-mono text-sm text-gray-800 dark:text-gray-200">
                {fixStatus}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
            ⚠️ Important Notes
          </h3>
          <ul className="text-yellow-700 dark:text-yellow-300 text-sm space-y-1">
            <li>
              • This only reads data from the old database (no modifications)
            </li>
            <li>
              • Make sure your Firestore security rules allow reads on the old
              project
            </li>
            <li>
              • Make sure your Firestore security rules allow writes on the new
              project
            </li>
            <li>• A JSON backup will be downloaded for safety</li>
          </ul>
        </div>

        {/* Vacation Migration Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4">
            🏖️ Vacation Periods Migration
          </h2>
          <p className="mb-4 text-gray-600">
            Export vacation periods from the old production database and import
            them to the new system. This will transform the data structure to
            match the new vacation management system.
          </p>

          <div className="flex gap-4 mb-4">
            <button
              onClick={exportVacations}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              disabled={vacationStatus.includes("Exporting")}
            >
              {vacationStatus.includes("Exporting")
                ? "Exporting..."
                : "Export Vacations from Old DB"}
            </button>

            <button
              onClick={importVacationsToNewProject}
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
              disabled={!vacationData || vacationStatus.includes("Importing")}
            >
              {vacationStatus.includes("Importing")
                ? "Importing..."
                : "Import to New Project"}
            </button>
          </div>

          {vacationStatus && (
            <div className="mb-4 p-3 bg-gray-100 rounded">
              <strong>Status:</strong> {vacationStatus}
            </div>
          )}

          {vacationLogs.length > 0 && (
            <div className="mb-4">
              <h3 className="font-bold mb-2">Migration Logs:</h3>
              <div className="bg-black text-green-400 p-3 rounded font-mono text-sm max-h-40 overflow-y-auto">
                {vacationLogs.map((log, index) => (
                  <div key={index}>{log}</div>
                ))}
              </div>
            </div>
          )}

          {vacationData && (
            <div className="border-t pt-4">
              <h3 className="font-bold mb-2">
                Exported Vacation Data ({vacationData.length} periods):
              </h3>
              <div className="bg-gray-50 p-3 rounded max-h-60 overflow-y-auto">
                <pre className="text-sm">
                  {JSON.stringify(vacationData, null, 2)}
                </pre>
              </div>

              <div className="mt-4 p-3 bg-blue-50 rounded">
                <h4 className="font-bold text-blue-800 mb-2">
                  🔄 Data Transformation Preview:
                </h4>
                <div className="text-sm text-blue-700">
                  <p>
                    <strong>Old Format:</strong>
                  </p>
                  <ul className="list-disc list-inside ml-4 mb-2">
                    <li>
                      createdAt: &quot;
                      {vacationData[0]?.createdAt || "timestamp"}&quot;
                    </li>
                    <li>
                      startDate: &quot;
                      {vacationData[0]?.startDate || "ISO date"}&quot;
                    </li>
                    <li>
                      endDate: &quot;{vacationData[0]?.endDate || "ISO date"}
                      &quot;
                    </li>
                  </ul>
                  <p>
                    <strong>New Format:</strong>
                  </p>
                  <ul className="list-disc list-inside ml-4">
                    <li>createdAt: (preserved)</li>
                    <li>updatedAt: (current timestamp)</li>
                    <li>startDate: (preserved)</li>
                    <li>endDate: (preserved)</li>
                    <li>reason: &quot;Migrated Vacation Period&quot;</li>
                    <li>migratedFrom: &quot;clinic-418813&quot;</li>
                    <li>originalId: (old document ID)</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Appointment Migration Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4">📅 Appointment Migration</h2>
          <p className="mb-4 text-gray-600">
            Export appointment data from the old production database and import
            them to the new system. This will transform the data structure to
            match the new appointment management system.
          </p>

          <div className="flex gap-4 mb-4">
            <button
              onClick={exportAppointments}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              disabled={appointmentStatus.includes("Exporting")}
            >
              {appointmentStatus.includes("Exporting")
                ? "Exporting..."
                : "Export Appointments from Old DB"}
            </button>

            <button
              onClick={importAppointmentsToNewProject}
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
              disabled={
                !appointmentData || appointmentStatus.includes("Importing")
              }
            >
              {appointmentStatus.includes("Importing")
                ? "Importing..."
                : "Import to New Project"}
            </button>

            <button
              onClick={deleteAllAppointments}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
              disabled={appointmentStatus.includes("Deleting")}
            >
              {appointmentStatus.includes("Deleting")
                ? "Deleting..."
                : "🗑️ Delete All Appointments"}
            </button>
          </div>

          {appointmentStatus && (
            <div className="mb-4 p-3 bg-gray-100 rounded">
              <strong>Status:</strong> {appointmentStatus}
            </div>
          )}

          {appointmentLogs.length > 0 && (
            <div className="mb-4">
              <h3 className="font-bold mb-2">Migration Logs:</h3>
              <div className="bg-black text-green-400 p-3 rounded font-mono text-sm max-h-40 overflow-y-auto">
                {appointmentLogs.map((log, index) => (
                  <div key={index}>{log}</div>
                ))}
              </div>
            </div>
          )}

          {appointmentData && (
            <div className="border-t pt-4">
              <h3 className="font-bold mb-2">
                Exported Appointment Data ({appointmentData.length} records):
              </h3>
              <div className="bg-gray-50 p-3 rounded max-h-60 overflow-y-auto">
                <pre className="text-sm">
                  {JSON.stringify(appointmentData, null, 2)}
                </pre>
              </div>

              <div className="mt-4 p-3 bg-blue-50 rounded">
                <h4 className="font-bold text-blue-800 mb-2">
                  🔄 Data Transformation Preview:
                </h4>
                <div className="text-sm text-blue-700">
                  <p>
                    <strong>Old Format:</strong>
                  </p>
                  <ul className="list-disc list-inside ml-4 mb-2">
                    <li>
                      createdAt: &quot;
                      {appointmentData[0]?.createdAt || "timestamp"}
                      &quot;
                    </li>
                    <li>
                      startDate: &quot;
                      {appointmentData[0]?.startDate || "ISO date"}&quot;
                    </li>
                    <li>
                      endDate: &quot;{appointmentData[0]?.endDate || "ISO date"}
                      &quot;
                    </li>
                  </ul>
                  <p>
                    <strong>New Format:</strong>
                  </p>
                  <ul className="list-disc list-inside ml-4">
                    <li>createdAt: (preserved)</li>
                    <li>updatedAt: (current timestamp)</li>
                    <li>startDate: (preserved)</li>
                    <li>endDate: (preserved)</li>
                    <li>reason: &quot;Migrated Appointment&quot;</li>
                    <li>migratedFrom: &quot;clinic-418813&quot;</li>
                    <li>originalId: (old document ID)</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
