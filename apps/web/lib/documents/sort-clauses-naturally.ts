// Ordena cláusulas pela ordem natural/documental do número — nunca
// alfabética pura, que colocaria "10" antes de "2" (a query em
// lib/data.ts não tem ORDER BY; o Postgres às vezes escolhe o índice
// btree (document_version_id, clause_number) para o scan, que é
// texto e produz exatamente essa ordem errada: "1, 10, 2, 3...").
//
// Cobre:
//   - inteiros simples: 1, 2, 9, 10;
//   - decimais por segmento: 1.1, 1.2, 1.10 (cada segmento entre
//     pontos comparado como número, nunca como "1.10" < "1.2" via
//     comparação de string/float);
//   - número seguido de letra: 2-A, 2-B, 10-A;
//   - valores vazios/não padronizados: nunca descartados — só
//     empurrados para o final, mantendo ordem estável entre si
//     (Array.prototype.sort já é estável desde ES2019).
//
// Não depende de nenhum campo novo de posição documental (não existe
// hoje em public.clauses — ver 20260818203331_clauses_foundation.sql)
// e não requer migration nem mudança de banco.

function tokenizeClauseNumber(value: string): (string | number)[] {
  const matches = value.match(/\d+|\D+/g) ?? [];
  return matches.map((token) => (/^\d+$/.test(token) ? Number(token) : token.toLowerCase()));
}

export function compareClauseNumbersNaturally(a: string, b: string): number {
  const aEmpty = a.trim() === "";
  const bEmpty = b.trim() === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const aTokens = tokenizeClauseNumber(a);
  const bTokens = tokenizeClauseNumber(b);
  const length = Math.max(aTokens.length, bTokens.length);

  for (let i = 0; i < length; i++) {
    const aToken = aTokens[i];
    const bToken = bTokens[i];
    if (aToken === undefined) return -1;
    if (bToken === undefined) return 1;

    if (typeof aToken === "number" && typeof bToken === "number") {
      if (aToken !== bToken) return aToken - bToken;
      continue;
    }

    const aText = String(aToken);
    const bText = String(bToken);
    if (aText !== bText) return aText < bText ? -1 : 1;
  }

  return 0;
}

export function sortClausesNaturally<T extends { clauseNumber: string }>(clauses: T[]): T[] {
  return [...clauses].sort((a, b) => compareClauseNumbersNaturally(a.clauseNumber, b.clauseNumber));
}
