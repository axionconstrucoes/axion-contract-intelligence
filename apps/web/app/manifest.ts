import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/ssma",
    name: "ACC SSMA/ESG",
    short_name: "ACC SSMA",
    description: "Aplicativo de campo SSMA/ESG da AXION Controle de Contratos.",
    // Abre o seletor de obras autorizadas do app de campo (exige login). A URL pública definitiva
    // do ACC vem do endereço em que o app é instalado — nada é fixado aqui.
    start_url: "/ssma",
    scope: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#7f1d1d",
    lang: "pt-BR",
    orientation: "portrait-primary",
    icons: [
      { src: "/branding/acc-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/branding/acc-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/branding/acc-logo.png", sizes: "1254x1254", type: "image/png", purpose: "any" },
    ],
  };
}
