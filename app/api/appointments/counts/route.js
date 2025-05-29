import { NextResponse } from "next/server";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

export async function GET() {
  try {
    // Get all appointments but only extract dates
    const q = query(collection(db, "customers"), orderBy("selectedDate"));
    const querySnapshot = await getDocs(q);

    const dateCounts = {};

    querySnapshot.docs.forEach((doc) => {
      const data = doc.data();
      let dateStr;

      try {
        // Handle mixed date formats server-side
        if (typeof data.selectedDate === "string") {
          if (data.selectedDate.includes("T")) {
            // New format: ISO string like '2025-06-25T22:00:00.000Z'
            dateStr = new Date(data.selectedDate).toISOString().split("T")[0];
          } else {
            // Old format: simple date string like '2025-06-26'
            dateStr = data.selectedDate;
          }
        } else if (data.selectedDate instanceof Date) {
          dateStr = data.selectedDate.toISOString().split("T")[0];
        } else if (data.selectedDate?.toDate) {
          // Firestore Timestamp
          dateStr = data.selectedDate.toDate().toISOString().split("T")[0];
        } else {
          console.warn("Unknown date format:", data.selectedDate);
          return;
        }

        // Count appointments by date
        dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
      } catch (error) {
        console.error("Error processing appointment date:", error);
      }
    });

    // Convert to array format
    const result = Object.entries(dateCounts).map(([date, count]) => ({
      date,
      count,
    }));

    console.log(
      `📊 Calendar counts API: Found ${result.length} dates with appointments`
    );

    return NextResponse.json({
      success: true,
      data: result,
      total: querySnapshot.size,
    });
  } catch (error) {
    console.error("Error fetching appointment counts:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
