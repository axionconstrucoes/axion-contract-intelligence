import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@axion/types", "@axion/mock-data", "@axion/db"],
  // pdfjs-dist NUNCA pode ser empacotado pelo Turbopack. Quando ele é,
  // duas coisas quebram de uma vez:
  //   1. o pdfjs carrega o worker com `await import("./pdf.worker.mjs")`
  //      — relativo AO MÓDULO. Empacotado, o relativo passa a apontar
  //      para .next/server/chunks/ssr/pdf.worker.mjs, que não existe, e
  //      getDocument() morre com "Setting up fake worker failed";
  //   2. `require.resolve` é reescrito para devolver um id numérico de
  //      módulo do bundler, então qualquer caminho derivado dele falha
  //      ("The path argument must be of type string. Received type
  //      number").
  // Externo, o pacote é exigido de node_modules em runtime e ambos os
  // caminhos voltam a ser caminhos de verdade.
  serverExternalPackages: ["pdfjs-dist"],
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
    "/*": [
      "public/branding/acc-logo.png",
      // Fontes padrão (base-14) do pdfjs-dist, usadas pela extração de
      // texto de minutas em PDF que não embutem a fonte. O caminho é
      // montado em runtime a partir de process.cwd() (ver
      // resolveStandardFontDataUrl em
      // lib/documents/extraction/extract-document-text.ts). O caminho é
      // derivado de require.resolve("pdfjs-dist/package.json") —
      // especificador literal, que o @vercel/nft rastreia — mas os
      // .pfb são lidos em runtime pelo próprio pdfjs, não importados,
      // então a inclusão dos arquivos é declarada aqui. Os dois padrões
      // cobrem o hoisting do npm workspaces (node_modules na raiz) e a
      // instalação local da app.
      // Fontes base-14 E o worker. Os dois são lidos em runtime pelo
      // próprio pdfjs (o worker por import dinâmico), não importados
      // estaticamente — o nft não os alcança sozinho. Os dois padrões
      // cobrem o hoisting do npm workspaces (node_modules na raiz) e a
      // instalação local da app.
      "../../node_modules/pdfjs-dist/standard_fonts/**",
      "node_modules/pdfjs-dist/standard_fonts/**",
      "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
