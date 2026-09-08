// Cores solidas dos 4 status de integracao — PENDENTE, ATIVO/CONECTADO,
// ATENCAO e ERRO — padronizacao visual GLOBAL (substitui a autorizacao
// anterior, que so cobria PENDENTE/ATIVO/ERRO e deixava ATENCAO
// translucido e o Construmanager com paleta propria).
//
// Fonte unica: `integrationClasses`, exportado de
// apps/web/components/shared/badges.tsx. Toda tela — Dashboard,
// Integracoes (fontes genericas E Construmanager), Email — consome o
// MESMO objeto, nunca duplica o mapa.
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
const CONSTRUMANAGER_BADGE_SRC = ler("apps/web/components/integrations/construmanager-status-badge.tsx");
const DASHBOARD_SUMMARY_SRC = ler("apps/web/components/dashboard/integration-status-summary.tsx");

function linhaDe(chave) {
  const m = BADGES_SRC.match(new RegExp(`${chave}:\\s*"[^"]*"`));
  return m ? m[0] : "";
}

const linhaPendente = linhaDe("PENDENTE");
const linhaConectado = linhaDe("CONECTADO");
const linhaErro = linhaDe("ERRO");
const linhaAtencao = linhaDe("ATENCAO");


// ============================================================
// 1. As quatro combinacoes obrigatorias.
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
  "ATENCAO: fundo laranja solido, texto branco, negrito (era translucido)",
  /bg-orange-500(?!\/)/.test(linhaAtencao) &&
    /text-white/.test(linhaAtencao) &&
    /font-bold/.test(linhaAtencao)
);

check(
  "ERRO: fundo vermelho solido #DC2626, texto branco #FFFFFF, negrito",
  /bg-\[#DC2626\]/.test(linhaErro) &&
    /text-\[#FFFFFF\]/.test(linhaErro) &&
    /font-bold/.test(linhaErro)
);


// ============================================================
// 2. Ausencia de transparencia/tokens antigos nos 4 estados.
// ============================================================

for (const [nome, linha] of [
  ["PENDENTE", linhaPendente],
  ["CONECTADO", linhaConectado],
  ["ATENCAO", linhaAtencao],
  ["ERRO", linhaErro],
]) {
  check(`${nome} nao usa opacidade /10, /15 ou /20`, !/\/(10|15|20)\b/.test(linha));
  check(`${nome} nao referencia mais token severity-* (era o antigo)`, !/severity-(baixa|media|critica)/.test(linha));
}


// ============================================================
// 3. Preservacao de texto, funcao, borda — nada alem da cor mudou.
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
  "integrationStatusLabels (lib/labels.ts) nao foi tocado — textos PENDENTE/Ativo/Atenção/ERRO preservados",
  (() => {
    const labels = ler("apps/web/lib/labels.ts");
    return /CONECTADO:\s*"Ativo"/.test(labels) &&
      /PENDENTE:\s*"Pendente"/.test(labels) &&
      /ATENCAO:\s*"Atenção"/.test(labels) &&
      /ERRO:\s*"Erro"/.test(labels);
  })()
);

check(
  "integrationClasses e' exportado (fonte unica reutilizavel) e aparece so 1 vez",
  (BADGES_SRC.match(/export const integrationClasses: Record<IntegrationStatus, string>/g) ?? []).length === 1
);


// ============================================================
// 4. Todo consumidor usa a MESMA fonte — sem mapa local duplicado em
//    nenhuma tela (Integracoes genericas, Email, Construmanager,
//    Dashboard).
// ============================================================

check(
  "integration-card.tsx usa IntegrationStatusBadge para as fontes nao-Construmanager",
  /<IntegrationStatusBadge status=\{status\} \/>/.test(INTEGRATION_CARD_SRC)
);

check(
  "email-integration-card.tsx usa o MESMO componente",
  /<IntegrationStatusBadge status=\{status\} \/>/.test(EMAIL_CARD_SRC)
);

check(
  "construmanager-status-badge.tsx NAO tem mais mapa proprio de cor de status de integracao (CONSTRUMANAGER_INTEGRATION_STATUS_CLASSES removido)",
  !/CONSTRUMANAGER_INTEGRATION_STATUS_CLASSES/.test(CONSTRUMANAGER_BADGE_SRC) &&
    !/Record<\s*\n?\s*IntegrationStatus,\s*\n?\s*string\s*\n?\s*>/.test(CONSTRUMANAGER_BADGE_SRC)
);

check(
  "ConstrumanagerIntegrationStatusBadge importa integrationClasses da fonte compartilhada",
  /import \{ integrationClasses \} from "@\/components\/shared\/badges";/.test(CONSTRUMANAGER_BADGE_SRC) &&
    /className=\{cn\(integrationClasses\[status\]\)\}/.test(CONSTRUMANAGER_BADGE_SRC)
);

check(
  "status de CONTEUDO do Construmanager (download por item — conceito diferente) continua com paleta propria, fora do escopo",
  /CONSTRUMANAGER_CONTENT_STATUS_CLASSES/.test(CONSTRUMANAGER_BADGE_SRC)
);

check(
  "Dashboard (card 'Status das integrações') NAO tem mais mapa proprio (STATUS_TONE_CLASSNAME removido)",
  !/STATUS_TONE_CLASSNAME/.test(DASHBOARD_SUMMARY_SRC)
);

check(
  "Dashboard importa integrationClasses da fonte compartilhada",
  /import \{ integrationClasses \} from "@\/components\/shared\/badges";/.test(DASHBOARD_SUMMARY_SRC) &&
    /integrationClasses\[group\.status\]/.test(DASHBOARD_SUMMARY_SRC)
);

check(
  "nenhum arquivo de integracao/dashboard redefine cor de status com hex literal fora de badges.tsx",
  !/bg-\[#(FFD600|166534|DC2626)\]/.test(INTEGRATION_CARD_SRC) &&
    !/bg-\[#(FFD600|166534|DC2626)\]/.test(EMAIL_CARD_SRC) &&
    !/bg-\[#(FFD600|166534|DC2626)\]/.test(DASHBOARD_SUMMARY_SRC) &&
    !/bg-\[#(FFD600|166534|DC2626)\]/.test(CONSTRUMANAGER_BADGE_SRC)
);


// ============================================================
console.log(`\n${passaram} passaram, ${falharam} falharam.`);
if (falharam > 0) process.exit(1);
