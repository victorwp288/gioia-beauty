import { createCancellationEmailPostHandler } from "@/lib/server/cancellationEmailHandler";

export const dynamic = "force-dynamic";

export const POST = createCancellationEmailPostHandler();
