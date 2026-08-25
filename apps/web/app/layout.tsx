import type { Metadata } from "next";
import { TestModeBanner } from "@/components/layout/test-mode-banner";
import "./globals.css";

// Título de aba do navegador: "ACC | <Nome da aba>" — cada page.tsx
// define seu próprio `title` curto (ex.: "Dashboard"), substituído no
// template abaixo. Nunca o nome técnico do repositório.
export const metadata: Metadata = {
  title: { template: "ACC | %s", default: "ACC | AXION Controle de Contratos" },
  description: "Plataforma de inteligência contratual para obras e projetos da Axion Engenharia.",
  icons: { icon: "/branding/acc-icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased font-sans">
        <div className="flex min-h-dvh flex-col">
          <TestModeBanner />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
