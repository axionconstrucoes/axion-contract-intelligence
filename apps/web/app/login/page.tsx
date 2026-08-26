import type { Metadata } from "next";
import {
  InstitutionalBackground,
  INSTITUTIONAL_BACKGROUND_SVG_PATH,
} from "@/components/brand/institutional-background";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { login } from "./actions";
import { GoogleSignInButton } from "./google-signin-button";

export const metadata: Metadata = { title: "Login" };

const oauthErrorMessages: Record<string, string> = {
  oauth_missing_code: "Não foi possível concluir o login com Google. Tente novamente.",
  oauth_exchange_failed: "Não foi possível concluir o login com Google. Tente novamente.",
  domain_not_allowed: "Acesso restrito a contas do domínio @axion.com.br.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const oauthError = error ? oauthErrorMessages[error] : undefined;
  // Revalidado aqui mesmo já vindo do proxy (nunca confiado só porque
  // apareceu na URL) — usado só para devolver o usuário ao destino
  // original depois do login; string vazia quando ausente/inseguro
  // (comportamento idêntico ao login sem destino).
  const safeNext = sanitizeInternalRedirect(next, "");

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-3 overflow-hidden p-4">
      <InstitutionalBackground />

      <Card className="relative w-full max-w-sm">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária */}
            <img src="/branding/acc-logo.png" alt="ACC" className="h-10 w-auto" />
          </div>
          <CardTitle className="text-base">AXION Controle de Contratos</CardTitle>
          <CardDescription>Acesso restrito a usuários autorizados por projeto.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <GoogleSignInButton next={safeNext} />
            {oauthError && <p className="text-xs text-destructive">{oauthError}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">ou</span>
            <Separator className="flex-1" />
          </div>

          <form action={login} className="flex flex-col gap-3">
            {safeNext ? <input type="hidden" name="next" value={safeNext} /> : null}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
                E-mail corporativo
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="nome@axion.com.br"
                autoComplete="email"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="password">
                Senha
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
            {error === "invalid_credentials" && (
              <p className="text-xs text-destructive">E-mail ou senha inválidos.</p>
            )}
            <Button type="submit" variant="outline" className="mt-2">
              Entrar com email e senha
            </Button>
          </form>
        </CardContent>
      </Card>

      <a
        href={INSTITUTIONAL_BACKGROUND_SVG_PATH}
        download
        className="relative text-xs text-white/70 underline decoration-dotted hover:text-white"
      >
        Baixar fundo institucional
      </a>
    </div>
  );
}
