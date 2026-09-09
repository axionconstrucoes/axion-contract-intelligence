import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ACC SSMA/ESG",
    short_name: "ACC SSMA",
    description: "Aplicativo de campo SSMA/ESG da AXION Controle de Contratos.",
    start_url: "/projetos",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#7f1d1d",
    lang: "pt-BR",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/branding/acc-logo.png",
        sizes: "1254x1254",
        type: "image/png",
      },
    ],
  };
}
