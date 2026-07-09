import { createBookingEmailPostHandler } from "@/lib/server/bookingEmailHandler";

export const dynamic = "force-dynamic";

export const POST = createBookingEmailPostHandler();
