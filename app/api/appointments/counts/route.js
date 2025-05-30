import { NextResponse } from "next/server";
import { db, trackDatabaseRead } from "@/lib/firebase/config";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  getCountFromServer,
  Timestamp,
} from "firebase/firestore";

// Force dynamic rendering for this route
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    console.log("📊 Using efficient per-date count aggregation...");

    // Get a reasonable date range for the calendar (last 3 months + next 6 months)
    const today = new Date();
    const startRange = new Date(today);
    startRange.setMonth(today.getMonth() - 3);
    startRange.setHours(0, 0, 0, 0);

    const endRange = new Date(today);
    endRange.setMonth(today.getMonth() + 6);
    endRange.setHours(23, 59, 59, 999);

    console.log("📅 Counting appointments in range:", {
      start: startRange.toISOString().split("T")[0],
      end: endRange.toISOString().split("T")[0],
    });

    // Based on your database sample, selectedDate is stored as Timestamp
    // So we need to use Timestamp for the query, not ISO strings
    const startTimestamp = Timestamp.fromDate(startRange);
    const endTimestamp = Timestamp.fromDate(endRange);

    console.log(
      "📊 Using Timestamp query (selectedDate is Timestamp in DB)..."
    );

    const q = query(
      collection(db, "customers"),
      where("selectedDate", ">=", startTimestamp),
      where("selectedDate", "<=", endTimestamp),
      orderBy("selectedDate")
    );

    const querySnapshot = await getDocs(q);

    // Track the efficient read
    trackDatabaseRead("counts-timestamp-query", querySnapshot.size);

    console.log(
      `📊 Retrieved ${querySnapshot.size} appointments in 9-month range (using Timestamp query)`
    );

    const dateCounts = {};

    querySnapshot.docs.forEach((doc) => {
      const data = doc.data();
      let dateStr;

      try {
        // Handle the selectedDate which should be a Timestamp
        if (data.selectedDate?.toDate) {
          // Firestore Timestamp - this is what we expect based on your sample
          dateStr = data.selectedDate.toDate().toISOString().split("T")[0];
        } else if (data.selectedDate instanceof Date) {
          dateStr = data.selectedDate.toISOString().split("T")[0];
        } else if (typeof data.selectedDate === "string") {
          // Fallback for any string dates
          if (data.selectedDate.includes("T")) {
            dateStr = new Date(data.selectedDate).toISOString().split("T")[0];
          } else {
            dateStr = data.selectedDate;
          }
        } else {
          console.warn(
            "Unexpected date format:",
            data.selectedDate,
            typeof data.selectedDate
          );
          return;
        }

        // Count appointments by date
        dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
      } catch (error) {
        console.error(
          "Error processing appointment date:",
          error,
          data.selectedDate
        );
      }
    });

    // Convert to array format
    const result = Object.entries(dateCounts).map(([date, count]) => ({
      date,
      count,
    }));

    console.log(
      `📊 Calendar counts API: Found ${result.length} dates with appointments (${querySnapshot.size} total appointments)`
    );

    // Log sample for debugging
    if (result.length > 0) {
      console.log("📊 Sample date counts:", result.slice(0, 3));
    }

    return NextResponse.json({
      success: true,
      data: result,
      total: querySnapshot.size,
      dateRange: {
        start: startRange.toISOString().split("T")[0],
        end: endRange.toISOString().split("T")[0],
      },
      message: "Efficient Timestamp-based counting for calendar badges",
    });
  } catch (error) {
    console.error("Error fetching appointment counts:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointment counts" },
      { status: 500 }
    );
  }
}
