// Evidencia de um achado — SCHEMA FECHADO por regra, e o hash dela.
//
// POR QUE NAO E' MAIS UM REGEX
//
// A versao anterior aceitava qualquer string que casasse
// `^[A-Za-z0-9_.-]{0,40}$`. Esse e' exatamente o alfabeto do base64url:
// um JWT truncado em 40 caracteres passava, e tambem um UUID de sessao,
// uma chave hex de 32 e um `sk-...`. O funil media a FORMA do texto
// quando o que importa e' QUE CAMPO ele ocupa.
//
// Agora nao existe campo de texto livre. Cada regra declara suas chaves,
// e cada chave tem um TIPO fechado: inteiro nao negativo, booleano, data
// ISO, codigo de categoria da taxonomia, prefixo de hash ou ObjectId. Uma
// chave fora da lista e' recusada; um valor fora do tipo e' recusado.
// Nao ha forma de um token, uma URL, um nome ou uma descricao caberem em
// nenhum dos tipos.
//
// ESTE ARQUIVO E' O ESPELHO DE UM CHECK DE BANCO
//
// O mesmo contrato existe em SQL, em `diario_de_obra_evidencia_valida`.
// Duas barreiras: a primeira da mensagem util ao desenvolvedor, a
// segunda continua valendo quando alguem escrever por outro caminho.
//
// ZERO IA. Nada aqui interpreta texto: e' tabela de tipos e sha256.

import { createHash } from "node:crypto";
import { CODIGOS_DE_CATEGORIA } from "./occurrence-taxonomy";

export type ValorDeEvidencia = number | boolean | string;
export type EvidenciaEstruturada = Record<string, ValorDeEvidencia>;

/** Os unicos tipos que uma evidencia pode conter. */
export type TipoDeCampo =
  | "inteiroNaoNegativo"
  | "inteiro"
  | "booleano"
  | "dataIso"
  | "categoria"
  | "hashPrefixo"
  | "objectId";

export const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
export const HASH_PREFIXO = /^[0-9a-f]{12}$/;
export const OBJECT_ID = /^[a-f0-9]{24}$/;

/** `evidence_key`: identificadores e codigos, jamais texto livre. */
export const FORMATO_DE_EVIDENCE_KEY = /^[A-Za-z0-9_.:-]{1,120}$/;

/**
 * Validador de UM campo.
 *
 * `objectId` existe para um unico campo (`tipoRef`) e nao pode ser
 * reaproveitado: uma cadeia de 24 hexadecimais e' indistinguivel de meia
 * chave de API, entao o tipo so vale onde o formato foi realmente
 * acordado com o fornecedor.
 */
export function valorCabeNoTipo(tipo: TipoDeCampo, valor: unknown): boolean {
  switch (tipo) {
    case "inteiroNaoNegativo":
      return typeof valor === "number" && Number.isInteger(valor) && valor >= 0;

    case "inteiro":
      return typeof valor === "number" && Number.isInteger(valor);

    case "booleano":
      return typeof valor === "boolean";

    case "dataIso":
      return typeof valor === "string" && DATA_ISO.test(valor);

    case "categoria":
      return typeof valor === "string" && CODIGOS_DE_CATEGORIA.includes(valor);

    case "hashPrefixo":
      return typeof valor === "string" && HASH_PREFIXO.test(valor);

    case "objectId":
      return typeof valor === "string" && OBJECT_ID.test(valor);

    default:
      return false;
  }
}

export interface CampoDeEvidencia {
  tipo: TipoDeCampo;
  obrigatorio: boolean;
}

export type EsquemaDeEvidencia = Readonly<Record<string, CampoDeEvidencia>>;

const obrigatorio = (tipo: TipoDeCampo): CampoDeEvidencia => ({ tipo, obrigatorio: true });
const opcional = (tipo: TipoDeCampo): CampoDeEvidencia => ({ tipo, obrigatorio: false });

/**
 * O contrato, regra por regra.
 *
 * O nome do campo carrega o tipo: `diasApos` e' inteiro em qualquer
 * regra, `data` e' data ISO em qualquer regra. Essa consistencia nao e'
 * estetica — e' o que permite ao CHECK do banco validar por NOME de
 * chave sem repetir a tabela inteira em plpgsql.
 */
export const ESQUEMA_POR_REGRA: Readonly<Record<string, EsquemaDeEvidencia>> = Object.freeze({
  CLIMA_IMPRATICAVEL_1_TURNO: { turnosImpraticaveis: obrigatorio("inteiroNaoNegativo") },
  CLIMA_IMPRATICAVEL_2_TURNOS: { turnosImpraticaveis: obrigatorio("inteiroNaoNegativo") },

  EFETIVO_ZERO_COM_ATIVIDADE: {
    efetivo: obrigatorio("inteiroNaoNegativo"),
    atividades: obrigatorio("inteiroNaoNegativo"),
  },

  ATIVIDADE_100_SEM_CONCLUSAO: { atividades: obrigatorio("inteiroNaoNegativo") },

  OCORRENCIA_REGISTRADA: {
    categoria: obrigatorio("categoria"),
    ocorrencias: obrigatorio("inteiroNaoNegativo"),
    tipoId: opcional("inteiroNaoNegativo"),
    tipoRef: opcional("objectId"),
  },

  EDICAO_TARDIA: {
    diasApos: obrigatorio("inteiroNaoNegativo"),
    dataReferencia: obrigatorio("dataIso"),
    dataEdicao: obrigatorio("dataIso"),
  },

  RDO_SEM_FOTO: { fotos: obrigatorio("inteiroNaoNegativo") },

  NUMERO_DUPLICADO: {
    numero: obrigatorio("inteiro"),
    ocorrencias: obrigatorio("inteiroNaoNegativo"),
  },

  DATA_DUPLICADA: {
    data: obrigatorio("dataIso"),
    ocorrencias: obrigatorio("inteiroNaoNegativo"),
  },

  SALTO_DE_NUMERACAO: {
    numeroAnterior: obrigatorio("inteiro"),
    numero: obrigatorio("inteiro"),
    faltando: obrigatorio("inteiroNaoNegativo"),
  },

  HASH_ALTERADO_POS_BASELINE: {
    baselineImportado: obrigatorio("booleano"),
    hashPrefixo: obrigatorio("hashPrefixo"),
  },
});

/**
 * Mapa global NOME DE CHAVE -> tipo.
 *
 * Existe para que o CHECK do banco possa validar sem duplicar o esquema
 * por regra, e para garantir aqui que nenhuma regra reuse um nome com
 * outro tipo — o que faria as duas barreiras divergirem em silencio.
 */
export const TIPO_POR_CHAVE: Readonly<Record<string, TipoDeCampo>> = Object.freeze(
  Object.values(ESQUEMA_POR_REGRA).reduce<Record<string, TipoDeCampo>>((acc, esquema) => {
    for (const [chave, campo] of Object.entries(esquema)) {
      if (acc[chave] !== undefined && acc[chave] !== campo.tipo) {
        throw new Error(
          `Chave de evidencia "${chave}" declarada com dois tipos diferentes.`
        );
      }
      acc[chave] = campo.tipo;
    }
    return acc;
  }, {})
);

export interface ResultadoDaValidacao {
  valida: boolean;
  motivo: string | null;
}

/**
 * Valida a evidencia contra o esquema da regra.
 *
 * Recusa: regra desconhecida, chave extra, chave obrigatoria ausente e
 * valor fora do tipo. Nao ha caminho permissivo — uma regra sem esquema
 * declarado nao grava evidencia nenhuma.
 */
export function validarEvidencia(
  ruleCode: string,
  evidencia: unknown
): ResultadoDaValidacao {
  const esquema = ESQUEMA_POR_REGRA[ruleCode];

  if (!esquema) {
    return { valida: false, motivo: `Regra sem esquema de evidencia declarado: ${ruleCode}.` };
  }

  if (evidencia === null || typeof evidencia !== "object" || Array.isArray(evidencia)) {
    return { valida: false, motivo: "Evidencia precisa ser um objeto." };
  }

  const entradas = Object.entries(evidencia as Record<string, unknown>);

  for (const [chave, valor] of entradas) {
    const campo = esquema[chave];

    if (!campo) {
      return { valida: false, motivo: `Chave nao prevista para ${ruleCode}: ${chave}.` };
    }

    if (!valorCabeNoTipo(campo.tipo, valor)) {
      return {
        valida: false,
        motivo: `Valor de ${chave} nao cabe no tipo ${campo.tipo}.`,
      };
    }
  }

  const presentes = new Set(entradas.map(([chave]) => chave));

  for (const [chave, campo] of Object.entries(esquema)) {
    if (campo.obrigatorio && !presentes.has(chave)) {
      return { valida: false, motivo: `Chave obrigatoria ausente em ${ruleCode}: ${chave}.` };
    }
  }

  return { valida: true, motivo: null };
}

/** `true` quando a evidencia cabe no contrato da regra. */
export function evidenciaSemConteudo(ruleCode: string, evidencia: unknown): boolean {
  return validarEvidencia(ruleCode, evidencia).valida;
}

/**
 * Falha alto quando a evidencia nao cabe no contrato.
 *
 * Lancar e' o comportamento correto: degradar para "achado sem
 * evidencia" esconderia o defeito. A execucao contabiliza o erro e segue
 * nos demais RDOs.
 */
export function assegurarEvidenciaSegura(
  ruleCode: string,
  evidencia: EvidenciaEstruturada
): EvidenciaEstruturada {
  const resultado = validarEvidencia(ruleCode, evidencia);

  if (!resultado.valida) {
    throw new Error(`Evidencia recusada. ${resultado.motivo}`);
  }

  return evidencia;
}

/**
 * Serializacao canonica: chaves ordenadas.
 *
 * Sem isso, a MESMA evidencia montada noutra ordem produziria hash
 * diferente, e um achado inalterado apareceria como reaberto a cada
 * execucao.
 */
export function canonicalizarEvidencia(evidencia: EvidenciaEstruturada): EvidenciaEstruturada {
  const destino: EvidenciaEstruturada = {};

  for (const chave of Object.keys(evidencia).sort()) {
    destino[chave] = evidencia[chave];
  }

  return destino;
}

/**
 * sha256 da evidencia canonica.
 *
 * E' o que distingue "o mesmo achado de novo" de "o achado mudou": hash
 * igual mantem tudo como esta; hash diferente marca ATUALIZADO.
 */
export function calcularHashDeEvidencia(
  ruleCode: string,
  evidencia: EvidenciaEstruturada
): string {
  assegurarEvidenciaSegura(ruleCode, evidencia);

  return createHash("sha256")
    .update(JSON.stringify(canonicalizarEvidencia(evidencia)), "utf8")
    .digest("hex");
}
