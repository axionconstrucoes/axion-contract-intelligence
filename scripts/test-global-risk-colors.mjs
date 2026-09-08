// Padrao DEFINITIVO de cor dos 4 graus de risco/severidade — cancela o
// esquema anterior (BAIXO amarelo, ALTO laranja) em qualquer tela do
// ACC. Fonte unica: `severityClasses`, exportado de
// apps/web/components/shared/badges.tsx, consumido por `SeverityBadge`
// e, por extensao, por toda tela que renderiza risco (Dashboard,
// Ledger, ESG, SLA, Adicionais, Experts IA, Analise Contratual,
// Start-up ACC).
//
// SEM REDE, SEM BANCO, SEM IA — so texto do arquivo fonte.
//
// Uso: node scripts/test-global-risk-colors.mjs

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
const RISK_LEGEND_SRC = ler("apps/web/components/shared/risk-legend.tsx");
const STARTUP_SRC = ler("apps/web/app/[projectId]/startup/page.tsx");
const GLOBALS_CSS = ler("apps/web/app/globals.css");

function linhaDe(chave) {
  const m = BADGES_SRC.match(new RegExp(`${chave}:\\s*"[^"]*"`));
  return m ? m[0] : "";
}

const linhaBaixa = linhaDe("BAIXA");
const linhaMedia = linhaDe("MEDIA");
const linhaAlta = linhaDe("ALTA");
const linhaCritica = linhaDe("CRITICA");


// ============================================================
// 1. As quatro combinacoes obrigatorias.
// ============================================================

check(
  "BAIXO: fundo verde-escuro solido #166534, texto branco, negrito",
  /bg-\[#166534\]/.test(linhaBaixa) && /text-\[#FFFFFF\]/.test(linhaBaixa) && /font-bold/.test(linhaBaixa)
);

check(
  "MEDIO: fundo azul solido #2563EB, texto branco, negrito",
  /bg-\[#2563EB\]/.test(linhaMedia) && /text-\[#FFFFFF\]/.test(linhaMedia) && /font-bold/.test(linhaMedia)
);

check(
  "ALTO: fundo amarelo forte solido #FFD600, texto PRETO, negrito",
  /bg-\[#FFD600\]/.test(linhaAlta) && /text-\[#000000\]/.test(linhaAlta) && /font-bold/.test(linhaAlta)
);

check(
  "CRITICO: fundo vermelho solido #DC2626, texto branco, negrito",
  /bg-\[#DC2626\]/.test(linhaCritica) && /text-\[#FFFFFF\]/.test(linhaCritica) && /font-bold/.test(linhaCritica)
);


// ============================================================
// 2. O padrao anterior foi explicitamente cancelado.
// ============================================================

check("BAIXO e' verde, NAO amarelo (padrao anterior cancelado)", !/bg-yellow/.test(linhaBaixa));
check(
  "ALTO e' amarelo, NAO laranja (padrao anterior cancelado — nunca mais bg-severity-alta/orange)",
  !/orange|severity-alta/.test(linhaAlta)
);
check("MEDIO continua azul (preservado, agora hex explicito)", /2563EB/.test(linhaMedia));
check("CRITICO continua vermelho (preservado, agora hex explicito)", /DC2626/.test(linhaCritica));


// ============================================================
// 3. Fundo solido, sem transparencia, em nenhum dos 4.
// ============================================================

for (const [nome, linha] of [
  ["BAIXA", linhaBaixa],
  ["MEDIA", linhaMedia],
  ["ALTA", linhaAlta],
  ["CRITICA", linhaCritica],
]) {
  check(`${nome} nao usa opacidade /10, /15 ou /20`, !/\/(10|15|20)\b/.test(linha));
  check(`${nome} nao referencia mais bg-severity-*/bg-risk-media (tokens antigos)`, !/bg-severity-|bg-risk-media/.test(linha));
}


// ============================================================
// 4. severityClasses e' exportado — fonte unica, sem duplicacao.
// ============================================================

check(
  "severityClasses e' exportado (fonte unica reutilizavel) e aparece so 1 vez",
  (BADGES_SRC.match(/export const severityClasses: Record<AlertSeverity, string>/g) ?? []).length === 1
);

check(
  "SeverityBadge continua renderizando severityLabels[severity] — texto BAIXO/MÉDIO/ALTO/CRÍTICO intocado",
  /export function SeverityBadge[\s\S]{0,700}severityLabels\[severity\]/.test(BADGES_SRC)
);

check(
  "severityLabels (lib/labels.ts) nao foi tocado — textos preservados",
  (() => {
    const labels = ler("apps/web/lib/labels.ts");
    return /BAIXA:\s*"Baixo"/.test(labels) &&
      /MEDIA:\s*"Médio"/.test(labels) &&
      /ALTA:\s*"Alto"/.test(labels) &&
      /CRITICA:\s*"Crítico"/.test(labels);
  })()
);


// ============================================================
// 5. RiskLegend: sem excecao por pagina — o antigo destaque amarelo
//    exclusivo do BAIXO na Start-up ACC foi removido.
// ============================================================

check(
  "RiskLegend nao tem mais a prop strongBaixaHighlight",
  !/strongBaixaHighlight/.test(RISK_LEGEND_SRC)
);

check(
  "RiskLegend nao aplica mais bg-yellow-400 a nenhum item",
  !/bg-yellow-400/.test(RISK_LEGEND_SRC)
);

check(
  "RiskLegend renderiza as 4 severidades sem className de override",
  /<SeverityBadge severity="BAIXA" withInfo \/>/.test(RISK_LEGEND_SRC) &&
    /<SeverityBadge severity="MEDIA" withInfo \/>/.test(RISK_LEGEND_SRC) &&
    /<SeverityBadge severity="ALTA" withInfo \/>/.test(RISK_LEGEND_SRC) &&
    /<SeverityBadge severity="CRITICA" withInfo \/>/.test(RISK_LEGEND_SRC)
);

check(
  "pagina Start-up ACC chama <RiskLegend /> sem prop nenhuma (herda o padrao global)",
  /<RiskLegend \/>/.test(STARTUP_SRC) && !/<RiskLegend strongBaixaHighlight/.test(STARTUP_SRC)
);


// ============================================================
// 6. Regras/calculo de severidade intocados — so a apresentacao mudou.
// ============================================================

check(
  "AlertSeverity (o TIPO/enum de severidade) nao foi redefinido aqui — so a paleta visual mudou",
  /Record<AlertSeverity, string>/.test(BADGES_SRC)
);

check(
  "globals.css: tokens --severity-*/--risk-media continuam existindo (usados por avisos/confirmacoes fora de badge, nao removidos)",
  /--severity-baixa:/.test(GLOBALS_CSS) &&
    /--severity-media:/.test(GLOBALS_CSS) &&
    /--severity-alta:/.test(GLOBALS_CSS) &&
    /--severity-critica:/.test(GLOBALS_CSS) &&
    /--risk-media:/.test(GLOBALS_CSS)
);


// ============================================================
console.log(`\n${passaram} passaram, ${falharam} falharam.`);
if (falharam > 0) process.exit(1);
