import { NextResponse } from "next/server";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";

// Force dynamic rendering for this route since it uses searchParams
export const dynamic = "force-dynamic";

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

    // Create date range for the specific day (much more efficient than downloading all)
    const startOfDay = new Date(targetDate + "T00:00:00.000Z");
    const endOfDay = new Date(targetDate + "T23:59:59.999Z");

    // Filter at database level - only get appointments for this specific date
    const q = query(
      collection(db, "customers"),
      where("selectedDate", ">=", startOfDay),
      where("selectedDate", "<=", endOfDay),
      orderBy("selectedDate"),
      orderBy("startTime")
    );

    const querySnapshot = await getDocs(q);

    const appointments = [];

    querySnapshot.docs.forEach((doc) => {
      const data = doc.data();

      try {
        // Handle mixed date formats for the returned data
        let appointmentDateStr;

        if (typeof data.selectedDate === "string") {
          if (data.selectedDate.includes("T")) {
            appointmentDateStr = new Date(data.selectedDate)
              .toISOString()
              .split("T")[0];
          } else {
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

        appointments.push({
          id: doc.id,
          ...data,
          // Normalize the date for consistency
          selectedDate: appointmentDateStr,
        });
      } catch (error) {
        console.error("Error processing appointment:", doc.id, error);
      }
    });

    // Sort by start time
    appointments.sort((a, b) => a.startTime.localeCompare(b.startTime));

    console.log(
      `📅 Found ${appointments.length} appointments for ${targetDate} (used efficient query)`
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
      { success: false, error: "Failed to fetch appointments" },
      { status: 500 }
    );
  }
}
