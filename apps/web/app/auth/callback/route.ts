import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@axion/db/server";

// Login corporativo: mesmo com o app OAuth do Google configurado como
// "Internal" no Workspace, a validação de domínio é feita aqui também —
// nunca confiar somente na configuração do provider/UI.
const ALLOWED_EMAIL_DOMAIN = "axion.com.br";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=oauth_missing_code", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
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

  return NextResponse.redirect(new URL("/projetos", url.origin));
}
