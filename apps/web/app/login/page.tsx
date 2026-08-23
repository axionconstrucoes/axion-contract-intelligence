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
    <div className="flex min-h-dvh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático em public/, sem otimização de imagem necessária */}
            <img src="/branding/acc-logo.svg" alt="ACC" className="h-10 w-auto" />
          </div>
          <CardTitle className="text-base">AXION Controle de Contratos</CardTitle>
          <CardDescription>Acesso restrito a usuários autorizados por projeto.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
