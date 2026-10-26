import type { Metadata, Viewport } from "next";

// Metadados de instalação do app de campo. O manifesto (app/manifest.ts) vale para o site todo; aqui
// entram só os complementos do iPhone (apple-touch-icon e modo standalone).
export const metadata: Metadata = {
  title: { template: "ACC SSMA | %s", default: "ACC SSMA" },
  appleWebApp: { capable: true, title: "ACC SSMA", statusBarStyle: "black-translucent" },
  icons: { apple: [{ url: "/branding/acc-apple-touch-icon.png", sizes: "180x180" }] },
};

export const viewport: Viewport = { themeColor: "#7f1d1d", width: "device-width", initialScale: 1 };

export default function SsmaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
