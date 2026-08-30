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

  const isPublicRoute =
    request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/auth/callback";

  if (!isPublicRoute && !data?.claims) {
    // Destino original preservado em ?next= para /login devolver o
    // usuário para cá depois do login (ex.: link de e-mail acionável) —
    // sempre o path+query da própria requisição já roteada para este
    // app (nunca uma URL externa: não há como isso virar open redirect
    // aqui). "/" nunca precisa ser preservado — já é o destino padrão
    // pós-login (ver app/page.tsx).
    const originalPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    if (originalPath !== "/") {
      redirectUrl.searchParams.set("next", originalPath);
    }

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
    // /auth/callback fica de fora: a própria rota já executa
    // exchangeCodeForSession (troca do code PKCE) e valida o domínio
    // @axion.com.br sozinha — deixar o proxy rodar aqui faria um segundo
    // cliente Supabase (getClaims()) tocar o mesmo jar de cookies da
    // requisição antes do handler consumir o code_verifier do PKCE.
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
