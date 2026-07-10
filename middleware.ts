import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PRIVATE_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

function privateResponse(request: NextRequest) {
  const response = NextResponse.next({ request });
  for (const [name, value] of Object.entries(PRIVATE_CACHE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  let response = privateResponse(request);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return response;

  try {
    const supabase = createServerClient(url, publishableKey, {
      cookieEncoding: "base64url",
      cookieOptions: {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: new URL(url).protocol === "https:",
      },
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
        },
      },
    });
    await supabase.auth.getUser();
  } catch {
    // The downstream server boundary returns a redacted 401/503 as appropriate.
  }
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/admin/:path*"],
  runtime: "nodejs",
};
