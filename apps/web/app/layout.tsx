import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import "./globals.css";

// Tipografia institucional do ACC (seção 7 do redesign): Open Sans,
// auto-hospedada no build pelo next/font (sem requisição externa em
// runtime, sem layout shift).
const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-open-sans",
  display: "swap",
});

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
    <html lang="pt-BR" className={openSans.variable}>
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
