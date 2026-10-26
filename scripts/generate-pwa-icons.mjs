// Gera os ícones do PWA (192, 512 e apple-touch 180) por REDIMENSIONAMENTO do logo oficial
// (public/branding/acc-logo.png) — sem redesenho. Uso: node scripts/generate-pwa-icons.mjs
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "branding");
const logo = await loadImage(path.join(dir, "acc-logo.png"));
for (const [name, size] of [["acc-icon-192.png", 192], ["acc-icon-512.png", 512], ["acc-apple-touch-icon.png", 180]]) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(logo, 0, 0, size, size);
  writeFileSync(path.join(dir, name), canvas.toBuffer("image/png"));
  console.log(`${name} ${size}x${size}`);
}
