import { NextResponse, type NextRequest } from "next/server";

import { createOwnerAuthClient } from "@/lib/server/auth/supabaseAuthClient.ts";

const PRIVATE_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

function applyPrivateCacheHeaders(response: NextResponse) {
  for (const [name, value] of Object.entries(PRIVATE_CACHE_HEADERS)) {
    response.headers.set(name, value);
  }
}

function privateResponse(request: NextRequest) {
  const response = NextResponse.next({ request });
  applyPrivateCacheHeaders(response);
  return response;
}

export async function proxy(request: NextRequest) {
  let response = privateResponse(request);

  try {
    const { auth } = createOwnerAuthClient({
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = privateResponse(request);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [name, value] of Object.entries(headers)) {
            response.headers.set(name, value);
          }
          applyPrivateCacheHeaders(response);
        },
      },
    });
    await auth.getUser();
  } catch {
    // The downstream server boundary returns a redacted 401/503 as appropriate.
  }
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/export/:path*"],
};
