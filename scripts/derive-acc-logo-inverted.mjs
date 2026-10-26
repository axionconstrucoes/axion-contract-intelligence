// Deriva a versão INVERTIDA do logo oficial ACC (public/branding/acc-logo.png)
// para fundos escuros (alertas de risco CRÍTICO/ALTO): troca vinho <-> branco
// ponto a ponto, interpolando pela luminância — o desenho e o anti-aliasing do
// arquivo oficial são preservados (nenhum traço é redesenhado).
//
// O arquivo oficial é RGB sem canal alfa (tile vinho opaco); o derivado mantém
// a mesma geometria e também não tem alfa.
//
// Uso: node scripts/derive-acc-logo-inverted.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const SRC = "apps/web/public/branding/acc-logo.png";
const OUT = "apps/web/public/branding/acc-logo-invertido.png";

const img = await loadImage(readFileSync(SRC));
const canvas = createCanvas(img.width, img.height);
const ctx = canvas.getContext("2d");
ctx.drawImage(img, 0, 0);
const data = ctx.getImageData(0, 0, img.width, img.height);
const px = data.data;

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Vinho oficial = cor dominante do fundo do tile; branco = 255.
const M = [115, 8, 31]; // vinho oficial dominante (amostrado do arquivo: 115,8,31)
const W = [255, 255, 255];
const LM = lum(...M);
const LW = lum(...W);

for (let i = 0; i < px.length; i += 4) {
  const t = Math.min(1, Math.max(0, (lum(px[i], px[i + 1], px[i + 2]) - LM) / (LW - LM)));
  // t=0 (vinho) -> branco ; t=1 (branco) -> vinho
  for (let c = 0; c < 3; c += 1) px[i + c] = Math.round(W[c] + (M[c] - W[c]) * t);
}
ctx.putImageData(data, 0, 0);
writeFileSync(OUT, canvas.toBuffer("image/png"));
console.log(`ok: ${OUT} (${img.width}x${img.height}); vinho oficial usado: rgb(${M.join(",")})`);
