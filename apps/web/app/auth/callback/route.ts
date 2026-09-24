import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@axion/db/server";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";

// Login corporativo: mesmo com o app OAuth do Google configurado como
// "Internal" no Workspace, a validação de domínio é feita aqui também —
// nunca confiar somente na configuração do provider/UI.
const ALLOWED_EMAIL_DOMAIN = "axion.com.br";

const POST_LOGIN_COOKIE = "acc_post_login_next";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Primeiro usa ?next=. Se o provedor OAuth não devolver a query string
  // completa, recupera a intenção preservada por cookie curto antes do
  // redirect ao Google. Ambos são revalidados pelo mesmo allowlist.
  const nextCandidate =
    url.searchParams.get("next") ??
    request.cookies.get(POST_LOGIN_COOKIE)?.value ??
    null;
  const nextDestination = sanitizeInternalRedirect(nextCandidate, "/projetos");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=oauth_missing_code", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Log estruturado e sanitizado: só os 3 campos do erro do GoTrue.
    // Nunca o code OAuth, cookies, tokens, query string, headers ou
    // valores de variável — nenhum deles entra neste objeto.
    console.error("[auth/callback] exchangeCodeForSession retornou erro", {
      errorCode: error.code,
      errorStatus: error.status,
      errorMessage: error.message,
    });
    return NextResponse.redirect(new URL("/login?error=oauth_exchange_failed", url.origin));
  }

  if (!data.session) {
    // Caso distinto do anterior: o GoTrue não reportou erro, mas também
    // não devolveu sessão — vale registrar separado para não confundir
    // com uma falha explícita do provider na leitura dos logs.
    console.error("[auth/callback] exchangeCodeForSession sem erro, mas sem sessão retornada");
    return NextResponse.redirect(new URL("/login?error=oauth_exchange_failed", url.origin));
  }

  const email = data.session.user.email;
  const emailDomain = email?.split("@")[1]?.toLowerCase();

  if (!email || emailDomain !== ALLOWED_EMAIL_DOMAIN) {
    // Sessão já foi criada pelo exchangeCodeForSession — revoga
    // explicitamente antes de redirecionar, para não deixar cookies de
    // sessão válidos para um domínio não autorizado.
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=domain_not_allowed", url.origin));
  }

  const response = NextResponse.redirect(new URL(nextDestination, url.origin));
  response.cookies.set(POST_LOGIN_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure: true,
  });
  return response;
}
