import QRCode from "qrcode";
import { SsmaOfflineCapabilities } from "@/components/ssma/ssma-offline-capabilities";
import { INSTALL_INSTRUCTIONS, resolveSsmaInstallUrl } from "@/lib/ssma/pwa-install";

// Instalação do app de campo por link e QR Code. O QR contém SOMENTE a URL configurada (ver
// lib/ssma/pwa-install.ts) — sem credenciais; quem escaneia ainda precisa entrar com a própria conta.
export async function SsmaInstallCard() {
  const install = resolveSsmaInstallUrl();
  const svg = install.ok ? await QRCode.toString(install.url, { type: "svg", margin: 1, width: 192, errorCorrectionLevel: "M" }) : null;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Instalar o app de campo">
      <h2 className="font-black uppercase text-slate-900">Instalar no celular</h2>
      {install.ok ? (
        <div className="flex flex-wrap items-start gap-4">
          <div role="img" aria-label="QR Code com o endereço do app de campo" className="size-48 shrink-0 rounded-lg border border-slate-300 bg-white p-1" dangerouslySetInnerHTML={{ __html: svg ?? "" }} />
          <div className="min-w-0 flex-1 space-y-1 text-sm text-slate-700">
            <p className="font-bold text-slate-900">Endereço</p>
            <p className="break-all font-mono text-xs">{install.url}</p>
            <p className="text-xs text-slate-500">O QR Code leva somente este endereço. Quem o abrir precisa entrar com a própria conta e só vê as obras de que participa.</p>
          </div>
        </div>
      ) : (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{install.message} O QR Code só é gerado depois de configurar o endereço.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm font-black text-slate-900">iPhone (Safari)</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">{INSTALL_INSTRUCTIONS.ios.map((step) => <li key={step}>{step}</li>)}</ol>
        </div>
        <div>
          <p className="text-sm font-black text-slate-900">Android (Chrome)</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">{INSTALL_INSTRUCTIONS.android.map((step) => <li key={step}>{step}</li>)}</ol>
        </div>
      </div>
      <p className="text-xs text-slate-500">Os passos podem variar conforme a versão do sistema e do navegador; ainda não foram validados em aparelhos reais.</p>
      <SsmaOfflineCapabilities />
    </section>
  );
}
