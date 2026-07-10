import { createBookingEmailPostHandler } from "@/lib/server/bookingEmailHandler";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";

const postHandler = createBookingEmailPostHandler();
export const POST = observeServerRoute(
  "email.booking.legacy",
  "POST",
  postHandler,
);
