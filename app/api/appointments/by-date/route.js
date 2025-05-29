import { NextResponse } from "next/server";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetDate = searchParams.get("date");

    if (!targetDate) {
      return NextResponse.json(
        { success: false, error: "Date parameter is required" },
        { status: 400 }
      );
    }

    console.log(`📅 Fetching appointments for date: ${targetDate}`);

    // Get all appointments and filter server-side (more efficient than downloading all to client)
    const q = query(
      collection(db, "customers"),
      orderBy("selectedDate"),
      orderBy("startTime")
    );
    const querySnapshot = await getDocs(q);

    const appointments = [];

    querySnapshot.docs.forEach((doc) => {
      const data = doc.data();
      let appointmentDateStr;

      try {
        // Handle mixed date formats server-side
        if (typeof data.selectedDate === "string") {
          if (data.selectedDate.includes("T")) {
            // New format: ISO string like '2025-06-25T22:00:00.000Z'
            appointmentDateStr = new Date(data.selectedDate)
              .toISOString()
              .split("T")[0];
          } else {
            // Old format: simple date string like '2025-06-26'
            appointmentDateStr = data.selectedDate;
          }
        } else if (data.selectedDate instanceof Date) {
          appointmentDateStr = data.selectedDate.toISOString().split("T")[0];
        } else if (data.selectedDate?.toDate) {
          // Firestore Timestamp
          appointmentDateStr = data.selectedDate
            .toDate()
            .toISOString()
            .split("T")[0];
        } else {
          console.warn("Unknown date format:", data.selectedDate);
          return;
        }

        // Only include appointments for the target date
        if (appointmentDateStr === targetDate) {
          appointments.push({
            id: doc.id,
            ...data,
            // Normalize the date for consistency
            selectedDate: appointmentDateStr,
          });
        }
      } catch (error) {
        console.error("Error processing appointment:", doc.id, error);
      }
    });

    // Sort by start time
    appointments.sort((a, b) => a.startTime.localeCompare(b.startTime));

    console.log(
      `📅 Found ${appointments.length} appointments for ${targetDate}`
    );

    return NextResponse.json({
      success: true,
      data: appointments,
      date: targetDate,
      count: appointments.length,
    });
  } catch (error) {
    console.error("Error fetching appointments by date:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
