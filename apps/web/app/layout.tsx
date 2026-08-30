import type { Metadata } from "next";
import { TestModeBanner } from "@/components/layout/test-mode-banner";
import "./globals.css";

// Título de aba do navegador: "ACC | <Nome da aba>" — cada page.tsx
// define seu próprio `title` curto (ex.: "Dashboard"), substituído no
// template abaixo. Nunca o nome técnico do repositório.
export const metadata: Metadata = {
  title: { template: "ACC | %s", default: "ACC | AXION Controle de Contratos" },
  description: "Plataforma de inteligência contratual para obras e projetos da Axion Engenharia.",
  // SVG primeiro (nítido em qualquer tamanho, preferido por navegadores
  // modernos); os PNGs são derivados só por redimensionamento do logo
  // oficial (public/branding/acc-logo.png, sem redesenho/vetorização) —
  // fallback para clientes que não suportam favicon SVG. Nenhum
  // apple-touch-icon/ícone de PWA: nenhum dos dois é usado por este
  // projeto hoje (sem manifest), então nenhum foi inventado.
  icons: {
    icon: [
      { url: "/branding/acc-icon.svg", type: "image/svg+xml" },
      { url: "/branding/acc-favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/branding/acc-favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/branding/acc-favicon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
  },
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
