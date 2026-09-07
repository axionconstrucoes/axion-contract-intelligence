// Evidencia de um achado — o que PODE ser guardado, e o hash dela.
//
// Um achado precisa provar de onde veio. A tentacao natural e' guardar
// o trecho do RDO que disparou a regra — e e' exatamente isso que este
// modulo proibe. A descricao de uma ocorrencia pode conter nome de
// trabalhador, endereco da frente de servico, telefone, link de foto. O
// achado nao precisa disso para ser util: precisa dizer QUAL regra,
// SOBRE QUAL RDO e COM QUE NUMEROS.
//
// A forma permitida e' estreita de proposito: sem espaco, sem ':', sem
// '/', sem '@', no maximo 40 caracteres. Uma frase nao cabe. Um nome
// completo nao cabe. Uma URL nao cabe. Uma data ISO, um enum e um
// ObjectId cabem.
//
// ESTE ARQUIVO E' O ESPELHO DE UM CHECK DE BANCO
//
// A mesma regra existe em SQL, em
// `diario_de_obra_evidencia_sem_conteudo`. Duas barreiras porque a
// primeira e' a que da mensagem util ao desenvolvedor, e a segunda e' a
// que continua valendo quando alguem escrever por outro caminho.
//
// ZERO IA. Nada aqui interpreta texto: e' expressao regular e sha256.

import { createHash } from "node:crypto";

/**
 * Forma unica aceita para STRING dentro de uma evidencia.
 *
 * Deliberadamente sem `\s`, `:`, `/` e `@`. `-` e `.` ficam porque data
 * ISO e numero decimal precisam deles.
 */
export const FORMATO_DE_TEXTO_EM_EVIDENCIA = /^[A-Za-z0-9_.-]{0,40}$/;

/** Chave de objeto: identificador simples, nunca um nome proprio. */
export const FORMATO_DE_CHAVE_EM_EVIDENCIA = /^[A-Za-z0-9_]{1,40}$/;

/** `evidence_key`: aceita ':' para compor `<rdo>:<qualificador>`. */
export const FORMATO_DE_EVIDENCE_KEY = /^[A-Za-z0-9_.:-]{1,120}$/;

export type ValorDeEvidencia =
  | string
  | number
  | boolean
  | null
  | ValorDeEvidencia[]
  | { [chave: string]: ValorDeEvidencia };

export type EvidenciaEstruturada = Record<string, ValorDeEvidencia>;

/**
 * `true` quando o valor inteiro cabe na forma permitida.
 *
 * Numero nao finito e' recusado: `NaN` e `Infinity` viram `null` em
 * JSON, e um campo que silenciosamente vira nulo e' pior que um erro.
 */
export function evidenciaSemConteudo(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;

  if (typeof valor === "boolean") return true;

  if (typeof valor === "number") return Number.isFinite(valor);

  if (typeof valor === "string") return FORMATO_DE_TEXTO_EM_EVIDENCIA.test(valor);

  if (Array.isArray(valor)) return valor.every((item) => evidenciaSemConteudo(item));

  if (typeof valor === "object") {
    return Object.entries(valor as Record<string, unknown>).every(
      ([chave, item]) =>
        FORMATO_DE_CHAVE_EM_EVIDENCIA.test(chave) && evidenciaSemConteudo(item)
    );
  }

  // Function, symbol, bigint: nao ha forma segura de serializar.
  return false;
}

/**
 * Falha alto quando a evidencia carrega conteudo.
 *
 * Lancar e' o comportamento correto: um achado com evidencia proibida
 * nao deve ser degradado para "achado sem evidencia" — isso esconderia
 * o defeito. A execucao contabiliza o erro e segue nos demais RDOs.
 */
export function assegurarEvidenciaSegura(evidencia: EvidenciaEstruturada): EvidenciaEstruturada {
  if (!evidenciaSemConteudo(evidencia)) {
    throw new Error(
      "Evidencia recusada: so numero, data, enum e booleano sao aceitos em structured_evidence."
    );
  }

  return evidencia;
}

/**
 * Serializacao canonica: chaves ordenadas em qualquer profundidade.
 *
 * Sem isso, a MESMA evidencia montada noutra ordem produziria hash
 * diferente, e um achado inalterado apareceria como reaberto a cada
 * execucao. A ordem dos ARRAYS e' preservada — nela a posicao e'
 * informacao (numeracao esperada, por exemplo).
 */
export function canonicalizarEvidencia(valor: ValorDeEvidencia): ValorDeEvidencia {
  if (valor === null || typeof valor !== "object") return valor;

  if (Array.isArray(valor)) return valor.map((item) => canonicalizarEvidencia(item));

  const destino: Record<string, ValorDeEvidencia> = {};

  for (const chave of Object.keys(valor).sort()) {
    destino[chave] = canonicalizarEvidencia(valor[chave]);
  }

  return destino;
}

/**
 * sha256 da evidencia canonica.
 *
 * E' o que distingue "o mesmo achado de novo" de "o achado mudou": hash
 * igual mantem um RESOLVED resolvido; hash diferente o reabre.
 */
export function calcularHashDeEvidencia(evidencia: EvidenciaEstruturada): string {
  assegurarEvidenciaSegura(evidencia);

  return createHash("sha256")
    .update(JSON.stringify(canonicalizarEvidencia(evidencia)), "utf8")
    .digest("hex");
}
