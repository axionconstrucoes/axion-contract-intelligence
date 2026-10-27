// Resumo, em linguagem simples, do que funciona sem sinal e do que exige internet no app de campo.
// Reflete SOMENTE o que está implementado e testado (ver docs/modulo-seguranca-pwa.md); componente
// sem estado e sem "use client", usável tanto em páginas de servidor quanto na tela de sincronização.

export const SSMA_WORKS_OFFLINE = [
  "Registrar ocorrência ou inspeção (categoria, descrição, local, data, risco, responsável e prazo) — fica salvo no aparelho.",
  "Anexar fotos JPG ou PNG ao registro — ficam no aparelho até o envio.",
  "Ver o estado de cada registro do aparelho: Salvo no aparelho, Aguardando envio, Sincronizado ou Falha.",
] as const;

export const SSMA_NEEDS_INTERNET = [
  "Enviar os registros e fotos (o envio é automático ao voltar o sinal, ou pelo botão “Enviar agora”).",
  "Ver a lista de registros já enviados da obra e suas fotos.",
  "Registrar andamento e concluir ação corretiva (inclui a foto de evidência).",
  "Consultar a IA (especialista de SSMA).",
  "Entrar na conta, trocar de conta ou de obra. Para usar sem sinal, abra o app uma vez com internet antes.",
] as const;

export const SSMA_PHOTO_LIMITS = "Fotos: JPG ou PNG, até 15 MB cada, no máximo 20 por registro, sem compressão. Fotos HEIC (formato padrão do iPhone) não são aceitas.";

export function SsmaOfflineCapabilities() {
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700" aria-label="O que funciona sem sinal">
      <p className="font-bold text-slate-900">O que funciona sem sinal</p>
      <ul className="list-disc space-y-1 pl-5">{SSMA_WORKS_OFFLINE.map((item) => <li key={item}>{item}</li>)}</ul>
      <p className="font-bold text-slate-900">O que exige internet</p>
      <ul className="list-disc space-y-1 pl-5">{SSMA_NEEDS_INTERNET.map((item) => <li key={item}>{item}</li>)}</ul>
      <p className="text-xs text-slate-500">{SSMA_PHOTO_LIMITS}</p>
      <p className="text-xs text-slate-500">O funcionamento sem sinal foi testado em navegador Chrome (IndexedDB e service worker reais); não foi validado em iPhone ou Android reais.</p>
    </section>
  );
}
