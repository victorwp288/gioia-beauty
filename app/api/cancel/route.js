import { createCancellationEmailPostHandler } from "@/lib/server/cancellationEmailHandler";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";

const postHandler = createCancellationEmailPostHandler();
export const POST = observeServerRoute(
  "email.cancellation.legacy",
  "POST",
  postHandler,
);
