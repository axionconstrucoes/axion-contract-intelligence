import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const oauthError = error ? oauthErrorMessages[error] : undefined;

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-brand-sidebar p-4">
      {/* Fundo institucional discreto — mesmo tom da sidebar, sem gradiente
          decorativo chamativo (seção 6 do redesign: evitar excesso). */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
        aria-hidden="true"
      />

      <Card className="relative w-full max-w-sm border-white/10 shadow-[var(--shadow-md)]">
        <CardHeader className="items-center gap-3 pt-8 pb-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária */}
          <img src="/branding/acc-logo.png" alt="ACC" className="h-12 w-auto rounded-lg" />
          <div className="flex flex-col gap-0.5">
            <CardTitle className="text-base tracking-tight">AXION Controle de Contratos</CardTitle>
            <CardDescription>Acesso restrito a usuários autorizados por projeto.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-6 pb-8">
          <div className="flex flex-col gap-2">
            <GoogleSignInButton />
            {oauthError && <p className="text-xs text-destructive">{oauthError}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">ou</span>
            <Separator className="flex-1" />
          </div>

          <form action={login} className="flex flex-col gap-3">
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
    </div>
  );
}
