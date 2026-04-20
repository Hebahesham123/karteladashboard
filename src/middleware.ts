import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If env vars are not set, let the request through to show a helpful page
  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes("your_supabase")) {
    const { pathname } = request.nextUrl;
    if (!pathname.startsWith("/login")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let session: any = null;
  try {
    const res = await supabase.auth.getSession();
    session = res.data.session;
  } catch {
    // Stale/invalid refresh cookie can throw here; treat as logged-out.
    const clean = NextResponse.redirect(new URL("/login", request.url));
    const toClear = request.cookies.getAll().map((c) => c.name);
    for (const name of toClear) {
      if (name.includes("sb-") || name.includes("supabase")) {
        clean.cookies.set(name, "", { path: "/", maxAge: 0 });
      }
    }
    return clean;
  }

  const { pathname } = request.nextUrl;

  // Public routes
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/setup") ||
    pathname.startsWith("/api")
  ) {
    if (session && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return response;
  }

  // Protected routes
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
