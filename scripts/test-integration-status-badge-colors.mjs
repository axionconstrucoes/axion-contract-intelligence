// Cores solidas de IntegrationStatusBadge (PENDENTE, ATIVO/CONECTADO,
// ERRO) — badge compartilhado usado por toda integracao que nao seja
// Construmanager (Diario de Obra, Email, Drive, ESG/SSMA, ...).
//
// Autorizado explicitamente por Reynaldo nesta sessao, na branch
// fix/diario-de-obra-monitoring-display: alto contraste (fundo solido
// + texto preto/branco + negrito) para PENDENTE/ATIVO/ERRO, sem tocar
// no badge proprio do Construmanager (paleta diferente, arquivo
// separado) nem no estado ATENCAO (continua translucido, de proposito
// — ver comentario em badges.tsx).
//
// SEM REDE, SEM BANCO, SEM IA — so texto do arquivo fonte.
//
// Uso: node scripts/test-integration-status-badge-colors.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passaram = 0;
let falharam = 0;

function check(rotulo, condicao) {
  if (condicao) {
    passaram += 1;
    console.log(`OK   ${rotulo}`);
  } else {
    falharam += 1;
    console.log(`FALHA ${rotulo}`);
  }
}

function ler(relativo) {
  return readFileSync(path.join(RAIZ, relativo), "utf8");
}

const BADGES_SRC = ler("apps/web/components/shared/badges.tsx");
const INTEGRATION_CARD_SRC = ler("apps/web/components/integrations/integration-card.tsx");
const EMAIL_CARD_SRC = ler("apps/web/components/integrations/email-integration-card.tsx");

function linhaDe(chave) {
  const m = BADGES_SRC.match(new RegExp(`${chave}:\\s*"[^"]*"`));
  return m ? m[0] : "";
}

const linhaPendente = linhaDe("PENDENTE");
const linhaConectado = linhaDe("CONECTADO");
const linhaErro = linhaDe("ERRO");
const linhaAtencao = linhaDe("ATENCAO");


// ============================================================
// 1. As tres combinacoes obrigatorias.
// ============================================================

check(
  "PENDENTE: fundo amarelo solido #FFD600, texto preto #000000, negrito",
  /bg-\[#FFD600\]/.test(linhaPendente) &&
    /text-\[#000000\]/.test(linhaPendente) &&
    /font-bold/.test(linhaPendente)
);

check(
  "ATIVO/CONECTADO: fundo verde-escuro solido #166534, texto branco #FFFFFF, negrito",
  /bg-\[#166534\]/.test(linhaConectado) &&
    /text-\[#FFFFFF\]/.test(linhaConectado) &&
    /font-bold/.test(linhaConectado)
);

check(
  "ERRO: fundo vermelho solido #DC2626, texto branco #FFFFFF, negrito",
  /bg-\[#DC2626\]/.test(linhaErro) &&
    /text-\[#FFFFFF\]/.test(linhaErro) &&
    /font-bold/.test(linhaErro)
);


// ============================================================
// 2. Ausencia das classes translucidas antigas nesses tres estados.
// ============================================================

for (const [nome, linha] of [
  ["PENDENTE", linhaPendente],
  ["CONECTADO", linhaConectado],
  ["ERRO", linhaErro],
]) {
  check(`${nome} nao usa mais opacidade /15 (era translucido)`, !/\/15/.test(linha));
  check(`${nome} nao referencia mais token severity-* (era o antigo)`, !/severity-(baixa|media|critica)/.test(linha));
}


// ============================================================
// 3. Preservacao dos demais estados — ATENCAO continua translucido, de
//    proposito (distinto de ERRO: falha nao bloqueante).
// ============================================================

check(
  "ATENCAO continua translucido (nao foi solidificado sem necessidade)",
  /bg-orange-500\/15/.test(linhaAtencao) && /text-orange-600/.test(linhaAtencao)
);

check(
  "ATENCAO nao ganhou negrito (nao e' um dos tres estados pedidos)",
  !/ATENCAO:\s*"[^"]*font-bold/.test(BADGES_SRC)
);


// ============================================================
// 4. Preservacao de texto, funcao, borda — nada alem da cor mudou.
// ============================================================

check(
  "todas as 4 chaves continuam com border-transparent (borda preservada)",
  /PENDENTE: "border-transparent/.test(BADGES_SRC) &&
    /CONECTADO: "border-transparent/.test(BADGES_SRC) &&
    /ATENCAO: "border-transparent/.test(BADGES_SRC) &&
    /ERRO: "border-transparent/.test(BADGES_SRC)
);

check(
  "o componente continua renderizando o rotulo de integrationStatusLabels — texto dos status intocado",
  /export function IntegrationStatusBadge[\s\S]{0,200}integrationStatusLabels\[status\]/.test(BADGES_SRC)
);

check(
  "integrationStatusLabels (lib/labels.ts) nao foi tocado — textos PENDENTE/Ativo/ERRO preservados",
  (() => {
    const labels = ler("apps/web/lib/labels.ts");
    return /CONECTADO:\s*"Ativo"/.test(labels) &&
      /PENDENTE:\s*"Pendente"/.test(labels) &&
      /ERRO:\s*"Erro"/.test(labels);
  })()
);

check(
  "o mapeamento continua UM SO Record<IntegrationStatus,string> — sem duplicacao",
  (BADGES_SRC.match(/const integrationClasses: Record<IntegrationStatus, string>/g) ?? []).length === 1
);

check(
  "SeverityBadge (outro componente/severidades) nao foi alterado por esta mudanca",
  /const severityClasses: Record<AlertSeverity, string> = \{\s*BAIXA: "border-transparent bg-severity-baixa\/15 text-severity-baixa",\s*MEDIA: "border-transparent bg-risk-media text-white font-bold",\s*ALTA: "border-transparent bg-severity-alta text-white font-bold",\s*CRITICA: "border-transparent bg-severity-critica text-white font-bold",\s*\};/.test(
    BADGES_SRC
  )
);


// ============================================================
// 5. O mesmo componente compartilhado e' usado nos 2 pontos de
//    integracao que nao sao Construmanager — sem duplicacao de
//    mapeamento em outro arquivo.
// ============================================================

check(
  "integration-card.tsx continua usando IntegrationStatusBadge para as fontes nao-Construmanager",
  /<IntegrationStatusBadge status=\{status\} \/>/.test(INTEGRATION_CARD_SRC)
);

check(
  "email-integration-card.tsx tambem usa o MESMO componente (ganha a cor nova automaticamente)",
  /<IntegrationStatusBadge status=\{status\} \/>/.test(EMAIL_CARD_SRC)
);

check(
  "nenhum arquivo de integracao redefine cor de status localmente (grep por bg-[#... fora de badges.tsx)",
  !/bg-\[#(FFD600|166534|DC2626)\]/.test(INTEGRATION_CARD_SRC) &&
    !/bg-\[#(FFD600|166534|DC2626)\]/.test(EMAIL_CARD_SRC)
);


// ============================================================
// 6. Badge do Construmanager (paleta PROPRIA, arquivo separado) fica
//    de fora — nao foi tocado por esta mudanca.
// ============================================================

check(
  "construmanager-status-badge.tsx nao foi tocado (paleta propria, fora do escopo)",
  (() => {
    const src = ler("apps/web/components/integrations/construmanager-status-badge.tsx");
    return /bg-yellow-400/.test(src) && /bg-green-600/.test(src) && /bg-red-600/.test(src);
  })()
);


// ============================================================
console.log(`\n${passaram} passaram, ${falharam} falharam.`);
if (falharam > 0) process.exit(1);
