import { analyzeEventAgainstClauses } from "./event-clause-confrontation-analyzer.mjs";

const event = {
  id: "event-1",
  title: "Atraso no cronograma da estrutura",
  description: "Cliente comunicou atraso de 20 dias na entrega da estrutura e possível aplicação de multa contratual."
};

const clauses = [
  {
    id: "clause-1",
    clauseNumber: "5.2",
    title: "Prazo de execução",
    text: "O prazo para execução dos serviços será de 180 dias conforme cronograma contratual."
  },
  {
    id: "clause-2",
    clauseNumber: "12.3",
    title: "Multas",
    text: "O atraso injustificado poderá sujeitar a contratada à aplicação de multa."
  },
  {
    id: "clause-3",
    clauseNumber: "8.1",
    title: "Pagamento",
    text: "As medições serão realizadas mensalmente e pagas conforme as condições comerciais."
  }
];

const result = analyzeEventAgainstClauses({
  event,
  clauses
});

console.table(
  result.map((item) => ({
    clause: item.clauseId,
    finding: item.findingType,
    severity: item.severity,
    confidence: item.confidence,
    categories: item.categories.join(", ")
  }))
);

if (result.length < 2) {
  throw new Error(
    "Esperadas pelo menos duas clausulas relacionadas."
  );
}

if (
  result.some(
    (item) =>
      item.findingType !== "IMPACTO_POTENCIAL"
  )
) {
  throw new Error(
    "O analisador v1 nao pode emitir conclusao juridica automatica."
  );
}

console.log("");
console.log("======================================");
console.log("EVENT x CLAUSE ANALYZER SMOKE: OK");
console.log("======================================");
