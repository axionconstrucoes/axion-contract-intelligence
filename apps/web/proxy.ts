import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const cookiesToApply = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const headersToApply = new Map<string, string>();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          supabaseResponse = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
            cookiesToApply.set(name, { name, value, options });
          });

          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value);
            headersToApply.set(key.toLowerCase(), value);
          });
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();

  const isPublicRoute = request.nextUrl.pathname === "/login";

  if (!isPublicRoute && !data?.claims) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";

    const redirectResponse = NextResponse.redirect(redirectUrl);

    cookiesToApply.forEach(({ name, value, options }) => {
      redirectResponse.cookies.set(name, value, options);
    });

    headersToApply.forEach((value, key) => {
      redirectResponse.headers.set(key, value);
    });

    return redirectResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
