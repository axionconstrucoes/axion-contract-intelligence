// Transporte de upload INJETÁVEL. Existe para que o comportamento do
// envio (progresso real, timeout, cancelamento, HTTP não-2xx, resposta
// inválida) seja testável sem rede e sem navegador — o teste injeta um
// transporte falso, a aplicação injeta o de XHR.
//
// Por que XHR e não fetch: `fetch` não expõe progresso de upload. O
// cliente do Supabase Storage usa fetch por baixo, então também não
// expõe — por isso esta tela fala direto com o endpoint REST do Storage.
// Nenhuma secret key participa disso: a autorização é o access token da
// sessão do próprio usuário, e a policy do Storage (ancorada no primeiro
// segmento do path, que é o projectId) é quem decide.

export type UploadFailureKind = "HTTP" | "REDE" | "TIMEOUT" | "CANCELADO" | "RESPOSTA_INVALIDA";

export class UploadTransportError extends Error {
  readonly kind: UploadFailureKind;
  readonly status: number | null;

  constructor(kind: UploadFailureKind, message: string, status: number | null = null) {
    super(message);
    this.name = "UploadTransportError";
    this.kind = kind;
    this.status = status;
  }
}

export interface UploadRequest {
  url: string;
  accessToken: string;
  body: Blob;
  contentType: string | null;
  timeoutMs: number;
  onProgress: (percent: number) => void;
  /** Recebe a função de cancelamento assim que o envio começa. */
  onAbortHandle?: (abort: () => void) => void;
}

export type UploadTransport = (request: UploadRequest) => Promise<void>;

/** Mensagens seguras por categoria — nunca o corpo bruto da resposta. */
export const UPLOAD_FAILURE_MESSAGES: Record<UploadFailureKind, string> = {
  HTTP: "Falha ao enviar o arquivo. Verifique o tamanho e o formato e tente novamente.",
  REDE: "Falha de rede ao enviar o arquivo. Verifique a conexão e tente novamente.",
  TIMEOUT: "O envio demorou demais e foi interrompido. Tente novamente.",
  CANCELADO: "Envio cancelado.",
  RESPOSTA_INVALIDA: "O armazenamento respondeu de forma inesperada. Tente novamente.",
};

/** Piso: nenhum envio tem menos de 2 minutos, por menor que seja. */
export const MIN_UPLOAD_TIMEOUT_MS = 120_000;
/** Teto: 15 minutos. Acima disso a aba fica pendurada sem propósito. */
export const MAX_UPLOAD_TIMEOUT_MS = 900_000;
/**
 * Velocidade mínima assumida para o cálculo — 64 KB/s. Deliberadamente
 * pessimista: é banda de 3G ruim, não de escritório. Um contrato de
 * 50 MB (o teto do bucket, ver migration 20260821004108) sai em
 * ~800 s por esta conta, dentro do teto de 15 min.
 */
export const MIN_UPLOAD_BYTES_PER_SECOND = 65_536;

/**
 * Timeout proporcional ao tamanho do arquivo, entre o piso e o teto.
 * O valor fixo anterior (120 s para tudo) derrubava envios grandes em
 * conexão lenta — o arquivo estava subindo normalmente e o navegador
 * desistia no meio.
 */
export function uploadTimeoutForSize(fileSizeBytes: number): number {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) return MIN_UPLOAD_TIMEOUT_MS;

  const proportional = Math.ceil((fileSizeBytes / MIN_UPLOAD_BYTES_PER_SECOND) * 1000);
  return Math.min(MAX_UPLOAD_TIMEOUT_MS, Math.max(MIN_UPLOAD_TIMEOUT_MS, proportional));
}

/** Mantido para quem não informa tamanho — equivale ao piso. */
export const DEFAULT_UPLOAD_TIMEOUT_MS = MIN_UPLOAD_TIMEOUT_MS;

/**
 * Transporte real. Só ele conhece XMLHttpRequest — todo o resto do
 * fluxo (hook, card, testes) fala com a interface UploadTransport.
 */
export const xhrUploadTransport: UploadTransport = (request) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const fail = (kind: UploadFailureKind, status: number | null = null) => {
      if (settled) return;
      settled = true;
      reject(new UploadTransportError(kind, UPLOAD_FAILURE_MESSAGES[kind], status));
    };

    xhr.open("POST", request.url, true);
    xhr.timeout = request.timeoutMs;
    xhr.setRequestHeader("Authorization", `Bearer ${request.accessToken}`);
    // Caminho imutável: um objeto nunca é sobrescrito. Se o path já
    // existe, o Storage recusa — e é isso que queremos.
    xhr.setRequestHeader("x-upsert", "false");
    if (request.contentType) xhr.setRequestHeader("Content-Type", request.contentType);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      // Teto em 99%: os 100% pertencem ao servidor ter aceitado o
      // objeto, não ao último byte ter saído do navegador.
      request.onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      if (settled) return;

      if (xhr.status < 200 || xhr.status >= 300) {
        console.error("[precontract-upload] Storage respondeu", xhr.status);
        fail("HTTP", xhr.status);
        return;
      }

      settled = true;
      request.onProgress(100);
      resolve();
    };

    xhr.onerror = () => fail("REDE");
    xhr.ontimeout = () => fail("TIMEOUT");
    xhr.onabort = () => fail("CANCELADO");

    request.onAbortHandle?.(() => {
      if (!settled) xhr.abort();
    });

    xhr.send(request.body);
  });
