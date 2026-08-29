import type { Metadata } from "next";
import { InstitutionalBackground } from "@/components/brand/institutional-background";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
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
          {/* Ajuste ESPECÍFICO da tela de login: logotipo 30% maior que o
              tamanho renderizado anterior (h-16 = 64px; 64 * 1.3 = 83.2px),
              proporção preservada (w-auto) e centralizado horizontalmente
              dentro da caixa branca (justify-center — único filho deste
              container). Independente do ajuste do logotipo do E-MAIL
              (20%, apps/web/lib/email/templates/contract-alert-template.ts)
              — dois lugares, dois requisitos separados, nunca confundidos.
              Mesmo asset oficial (/branding/acc-logo.png), nenhuma cópia
              nova criada. */}
          <div className="mb-2 flex items-center justify-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária */}
            <img src="/branding/acc-logo.png" alt="ACC" className="h-[83.2px] w-auto" />
          </div>
          <CardTitle className="text-base">AXION Controle de Contratos</CardTitle>
          <CardDescription>
            Acesso restrito a usuários autorizados por projeto — autenticação exclusiva pela conta Google corporativa.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <GoogleSignInButton next={safeNext} />
          {oauthError && <p className="text-xs text-destructive">{oauthError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
