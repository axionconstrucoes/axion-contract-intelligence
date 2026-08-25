// SHA-256 via Web Crypto (crypto.subtle) — disponível tanto no
// navegador quanto no Node (>=20, usado pelos testes deste repo).
// Nunca envia o arquivo para calcular o hash: tudo roda localmente.

export async function computeSha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeFileSha256Hex(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  return computeSha256Hex(buffer);
}
