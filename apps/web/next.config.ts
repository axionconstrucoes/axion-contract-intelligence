import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@axion/types", "@axion/mock-data", "@axion/db"],
  // O logo institucional ACC (public/branding/acc-logo.png) é lido em
  // runtime via fs a partir de um caminho montado dinamicamente
  // (path.join(process.cwd(), ...) em load-acc-logo-inline-image.ts) para
  // ser embutido por Content-ID nos e-mails — exatamente o padrão que a
  // documentação do Next.js aponta como caso em que o Output File Tracing
  // (@vercel/nft) pode falhar em incluir o arquivo no bundle da função
  // serverless (fs com caminho não 100% estático). Verificado nesta
  // sessão que o nft desta versão já rastreia o arquivo mesmo sem esta
  // entrada (.next/server/**/*.nft.json já lista public/branding/acc-logo.png);
  // mesmo assim, deixamos explícito — é a correção documentada pelo
  // Next.js para essa classe de problema, custo zero, e remove qualquer
  // dependência de um comportamento implícito do nft que pode variar
  // entre versões. Se o logo ainda não aparecer após isto, o próximo
  // ponto a investigar é do lado do Gmail (ex.: truncamento/"clipping" de
  // mensagens grandes, que corta primeiro o que vem no fim do e-mail —
  // e a assinatura com o logo é sempre anexada por último).
  outputFileTracingIncludes: {
    "/*": ["public/branding/acc-logo.png"],
  },
};

export default nextConfig;
