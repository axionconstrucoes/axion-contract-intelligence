// Executado pelo runner nativo do Node (`npm test` em apps/web →
// `node --test`). Arquivo .mjs importando o módulo .ts diretamente
// (type stripping nativo do Node ≥ 22.6) — sem framework de testes nem
// transpilador extra no repositório.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLinkStatusAppearance, resolveLinkStatus } from "./link-status-appearance.ts";

describe("getLinkStatusAppearance — cor segue o ESTADO do vínculo, nunca a ação", () => {
  it("vinculado = verde", () => {
    const appearance = getLinkStatusAppearance("linked");
    assert.equal(appearance.status, "linked");
    assert.equal(appearance.statusLabel, "Vinculado");
    assert.match(appearance.triggerClassName, /\bbg-emerald-600\b/);
    assert.doesNotMatch(appearance.triggerClassName, /\bbg-red-/);
    assert.doesNotMatch(appearance.disabledClassName, /red/);
  });

  it("desvinculado = vermelho", () => {
    const appearance = getLinkStatusAppearance("unlinked");
    assert.equal(appearance.status, "unlinked");
    assert.equal(appearance.statusLabel, "Desvinculado");
    assert.match(appearance.triggerClassName, /\bbg-red-600\b/);
    assert.doesNotMatch(appearance.triggerClassName, /\bbg-emerald-/);
    assert.doesNotMatch(appearance.disabledClassName, /emerald/);
  });

  it("nunca mistura as duas famílias de cor no mesmo gatilho (classes Tailwind conflitantes)", () => {
    for (const status of ["linked", "unlinked"]) {
      const { triggerClassName, disabledClassName } = getLinkStatusAppearance(status);
      const backgrounds = `${triggerClassName} ${disabledClassName}`.match(/(?:^|\s)(?:hover:|disabled:)?bg-[a-z]+-\d+/g) ?? [];
      const families = new Set(backgrounds.map((cls) => cls.trim().replace(/^(hover:|disabled:)?bg-/, "").replace(/-\d+$/, "")));
      assert.equal(families.size, 1, `${status}: ${[...families].join(", ")}`);
    }
  });
});

describe("resolveLinkStatus — mudança de estado atualiza a cor imediatamente", () => {
  it("controle de DESVINCULAR nasce verde (documento vinculado)", () => {
    assert.equal(resolveLinkStatus({ linkedOnLoad: true, lastActionSucceeded: false }), "linked");
  });

  it("após desvincular com sucesso vira vermelho, sem recarregar", () => {
    const before = getLinkStatusAppearance(resolveLinkStatus({ linkedOnLoad: true, lastActionSucceeded: false }));
    const after = getLinkStatusAppearance(resolveLinkStatus({ linkedOnLoad: true, lastActionSucceeded: true }));
    assert.match(before.triggerClassName, /bg-emerald-600/);
    assert.match(after.triggerClassName, /bg-red-600/);
  });

  it("controle de VINCULAR nasce vermelho (documento desvinculado)", () => {
    assert.equal(resolveLinkStatus({ linkedOnLoad: false, lastActionSucceeded: false }), "unlinked");
  });

  it("após vincular com sucesso vira verde, sem recarregar", () => {
    const before = getLinkStatusAppearance(resolveLinkStatus({ linkedOnLoad: false, lastActionSucceeded: false }));
    const after = getLinkStatusAppearance(resolveLinkStatus({ linkedOnLoad: false, lastActionSucceeded: true }));
    assert.match(before.triggerClassName, /bg-red-600/);
    assert.match(after.triggerClassName, /bg-emerald-600/);
  });

  it("ação com erro NÃO muda o estado exibido", () => {
    assert.equal(resolveLinkStatus({ linkedOnLoad: true, lastActionSucceeded: false }), "linked");
    assert.equal(resolveLinkStatus({ linkedOnLoad: false, lastActionSucceeded: false }), "unlinked");
  });
});
