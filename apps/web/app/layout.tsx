import type { Metadata } from "next";
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
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
