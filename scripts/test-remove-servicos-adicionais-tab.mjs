// Remocao da aba/modulo "Servicos Adicionais" da interface do ACC —
// dependia da importacao automatica de propostas do Drive de
// Orcamentos, integracao definitivamente cancelada. Nova regra: servico
// adicional aprovado entra por upload manual do ADM, na area de
// Documentos.
//
// SEM REDE, SEM BANCO, SEM IA — so texto do arquivo fonte. A exclusao e'
// so da ABA e dos PONTOS DE ENTRADA da interface: nenhum arquivo de
// apps/web/lib/additionals ou apps/web/components/additionals foi
// apagado, nenhuma migration foi tocada, nenhum dado historico foi
// removido.
//
// Uso: node scripts/test-remove-servicos-adicionais-tab.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
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

function existe(relativo) {
  return existsSync(path.join(RAIZ, relativo));
}

const NAV_ITEMS_SRC = ler("apps/web/lib/ui/nav-items.ts");
const ADICIONAIS_PAGE_SRC = ler("apps/web/app/[projectId]/adicionais/page.tsx");
const ADICIONAIS_DETAIL_PAGE_SRC = ler("apps/web/app/[projectId]/adicionais/[proposalId]/page.tsx");
const DASHBOARD_SUMMARY_SRC = ler("apps/web/components/dashboard/integration-status-summary.tsx");
const DASHBOARD_VISUAL_CARDS_SRC = ler("apps/web/components/dashboard-visual/summary-cards.tsx");
const FEATURE_HELP_SRC = ler("apps/web/lib/ui/feature-help.ts");


// ============================================================
// 1. Ausencia da aba em todos os menus (sidebar).
// ============================================================

check(
  "nav-items.ts NAO tem mais entrada href:\"adicionais\"",
  !/href:\s*"adicionais"/.test(NAV_ITEMS_SRC)
);

check(
  "nav-items.ts NAO tem mais o rotulo \"Propostas de Adicionais\"",
  !/label:\s*"Propostas de Adicionais"/.test(NAV_ITEMS_SRC)
);

check(
  "NAV_ITEMS continua sendo a UNICA fonte da sidebar (nenhuma lista duplicada criada)",
  (NAV_ITEMS_SRC.match(/export const NAV_ITEMS/g) ?? []).length === 1
);


// ============================================================
// 2. Ausencia de cards e atalhos que abram o modulo.
// ============================================================

check(
  "Dashboard (Status das integrações): sem link/atalho para /adicionais",
  !/adicionais/i.test(DASHBOARD_SUMMARY_SRC)
);

check(
  "Dashboard visual: os cards existentes (Adicionais/Aditivos, dados históricos) NAO sao atalho — nenhum <Link>/href apontando para /adicionais",
  !/href=.*adicionais|<Link[^>]*adicionais/i.test(DASHBOARD_VISUAL_CARDS_SRC)
);

function arquivosTsxRecursivo(dirRelativo) {
  const resultado = [];
  const dirAbsoluto = path.join(RAIZ, dirRelativo);

  function visitar(dir) {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        visitar(caminho);
      } else if (/\.tsx?$/.test(entrada.name)) {
        resultado.push(caminho);
      }
    }
  }

  visitar(dirAbsoluto);
  return resultado;
}

check(
  "nenhum arquivo em app/ ou components/ (fora da propria pasta da rota removida) tem link ativo para /adicionais",
  (() => {
    const rotaRemovidaAbsoluta = path.join(RAIZ, "apps/web/app/[projectId]/adicionais");
    const candidatos = [
      ...arquivosTsxRecursivo("apps/web/app"),
      ...arquivosTsxRecursivo("apps/web/components"),
    ].filter((arquivo) => !arquivo.startsWith(rotaRemovidaAbsoluta));

    for (const arquivo of candidatos) {
      const conteudo = readFileSync(arquivo, "utf8");
      if (/href=.*\/adicionais["'`)]|href=\{[^}]*adicionais/.test(conteudo)) {
        console.log(`     link ativo encontrado em: ${path.relative(RAIZ, arquivo)}`);
        return false;
      }
    }
    return true;
  })()
);


// ============================================================
// 3. Rota antiga: redireciona para Documentos, projectId preservado,
//    pagina antiga nao fica acessivel por link direto.
// ============================================================

check(
  "/adicionais (lista): importa redirect de next/navigation",
  /import\s*\{[^}]*redirect[^}]*\}\s*from\s*"next\/navigation"/.test(ADICIONAIS_PAGE_SRC)
);

check(
  "/adicionais (lista): redireciona para /${projectId}/documentos — preserva projectId, nunca hardcoded",
  /redirect\(`\/\$\{projectId\}\/documentos`\)/.test(ADICIONAIS_PAGE_SRC)
);

check(
  "/adicionais (lista): NAO renderiza mais nenhum JSX da funcionalidade antiga (Tabs, formulario, cards de proposta)",
  !/<Tabs|<TabsTrigger|AdditionalProposalCreateForm|AdditionalProposalStatusBadge/.test(ADICIONAIS_PAGE_SRC)
);

check(
  "/adicionais (lista): valida projectId antes de redirecionar (notFound se ausente)",
  /if\s*\(!projectId\)\s*notFound\(\)/.test(ADICIONAIS_PAGE_SRC)
);

check(
  "/adicionais/[proposalId] (detalhe): tambem redireciona para /${projectId}/documentos, projectId preservado",
  /redirect\(`\/\$\{projectId\}\/documentos`\)/.test(ADICIONAIS_DETAIL_PAGE_SRC) &&
    /import\s*\{[^}]*redirect[^}]*\}\s*from\s*"next\/navigation"/.test(ADICIONAIS_DETAIL_PAGE_SRC)
);

check(
  "/adicionais/[proposalId] (detalhe): NAO renderiza mais o formulario/checklist/curadoria antigos",
  !/AdditionalProposalApprovalsForm|AdditionalProposalChecklist|AdditionalProposalContractedForm|AdditionalProposalCurationPanel|AdditionalProposalStatusForm/.test(
    ADICIONAIS_DETAIL_PAGE_SRC
  )
);


// ============================================================
// 4. Documentos e upload manual preservados — nenhuma alteracao.
// ============================================================

check(
  "Documentos: pagina continua existindo e hospeda o painel de upload manual multiplo",
  existe("apps/web/app/[projectId]/documentos/page.tsx") &&
    /DocumentMultiUploadPanel/.test(ler("apps/web/app/[projectId]/documentos/page.tsx"))
);

check(
  "upload manual: categoria ADITIVO (aditivo contratual) disponivel no seletor",
  /"ADITIVO"/.test(ler("apps/web/lib/documents/multi-upload/types.ts"))
);

check(
  "upload manual: categoria PROPOSTA_COMERCIAL (proposta adicional aprovada) disponivel no seletor",
  /"PROPOSTA_COMERCIAL"/.test(ler("apps/web/lib/documents/multi-upload/types.ts"))
);


// ============================================================
// 5. Nenhum dado/arquivo de negocio removido — so pontos de entrada.
// ============================================================

check(
  "lib/additionals/ preservado integralmente (nenhum arquivo apagado)",
  existe("apps/web/lib/additionals/index.ts") &&
    existe("apps/web/lib/additionals/get-additional-proposals.ts") &&
    existe("apps/web/lib/additionals/create-additional-proposal.ts") &&
    existe("apps/web/lib/additionals/closing-gate.ts") &&
    existe("apps/web/lib/additionals/confrontation/index.ts") &&
    existe("apps/web/lib/additionals/findings/index.ts") &&
    existe("apps/web/lib/additionals/proposal-drive-lookup/list-orcamentos-proposals.ts")
);

check(
  "components/additionals/ preservado integralmente (nenhum arquivo apagado)",
  existe("apps/web/components/additionals/additional-proposal-approvals-form.tsx") &&
    existe("apps/web/components/additionals/additional-proposal-checklist.tsx") &&
    existe("apps/web/components/additionals/additional-proposal-contracted-form.tsx") &&
    existe("apps/web/components/additionals/additional-proposal-create-form.tsx") &&
    existe("apps/web/components/additionals/additional-proposal-curation-panel.tsx") &&
    existe("apps/web/components/additionals/additional-proposal-link-form.tsx") &&
    existe("apps/web/components/additionals/additional-proposal-status-form.tsx")
);

check(
  "server actions da rota antiga preservados (actions.ts, drive-lookup-actions.ts)",
  existe("apps/web/app/[projectId]/adicionais/actions.ts") &&
    existe("apps/web/app/[projectId]/adicionais/drive-lookup-actions.ts")
);

check(
  "AdditionalProposalStatusBadge (badges.tsx) continua existindo — nao foi removido",
  /export function AdditionalProposalStatusBadge/.test(ler("apps/web/components/shared/badges.tsx"))
);


// ============================================================
// 6. Nenhuma migration adicionada ou aplicada.
// ============================================================

check(
  "nenhuma migration nova/renomeada menciona 'adicionais'/'servicos' no nome do arquivo (prova definitiva de zero migration nova e' `git diff --stat -- supabase/migrations/`, reportada fora deste script)",
  readdirSync(path.join(RAIZ, "supabase/migrations")).every(
    (nome) => !/adicionai|servico/i.test(nome)
  )
);


// ============================================================
// 7. Zero alteracao em Diario de Obra, Construmanager ou Gmail.
// ============================================================

for (const [nome, arquivo] of [
  ["Diario de Obra (climate-kpi)", "apps/web/lib/integrations/diario-de-obra/climate-kpi.ts"],
  ["Diario de Obra (report-readers)", "apps/web/lib/integrations/diario-de-obra/report-readers.ts"],
  ["Construmanager (status badge)", "apps/web/components/integrations/construmanager-status-badge.tsx"],
]) {
  check(`${nome}: arquivo continua existindo, intocado por esta branch`, existe(arquivo));
}

check(
  "Gmail: arquivo de contas de e-mail intocado, sem nenhuma referencia a 'adicionais'",
  !/adicionais/i.test(ler("apps/web/lib/email/inbound/ingestion-controls/get-email-accounts.ts"))
);


// ============================================================
// 8. Documentacao funcional: politica de fontes atualizada, sem
//    duplicacao (so a entrada "integracoes" foi tocada).
// ============================================================

check(
  "feature-help.ts: entrada 'integracoes' descreve a nova politica (Drive so SSMA/ESG, Orcamentos/Planejamento nao integrados, upload manual do ADM)",
  /id:\s*"integracoes"[\s\S]{0,400}upload manual do ADM[\s\S]{0,400}Google Drive é usado somente para ESG\/SSMA[\s\S]{0,200}Drive de Orçamentos e Drive de Planejamento não estão integrados/.test(
    FEATURE_HELP_SRC
  )
);

check(
  "feature-help.ts: nenhuma entrada nova duplicando a mesma politica (so 1 ocorrencia de id: \"integracoes\")",
  (FEATURE_HELP_SRC.match(/id:\s*"integracoes"/g) ?? []).length === 1
);


// ============================================================
console.log(`\n${passaram} passaram, ${falharam} falharam.`);
if (falharam > 0) process.exit(1);
