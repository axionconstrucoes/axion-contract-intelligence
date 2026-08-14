import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">AXION Contract Intelligence</CardTitle>
          <CardDescription>Acesso restrito a usuários autorizados por projeto.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
              E-mail corporativo
            </label>
            <Input id="email" type="email" placeholder="nome@axion.com.br" defaultValue="ana.souza@axion.com.br" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="password">
              Senha
            </label>
            <Input id="password" type="password" placeholder="••••••••" defaultValue="demo" />
          </div>
          <Link href="/projetos" className={buttonVariants({ className: "mt-2" })}>
            Entrar
          </Link>
          <p className="text-center text-xs text-muted-foreground">
            Autenticação simulada — fase 1 sem integração real.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
