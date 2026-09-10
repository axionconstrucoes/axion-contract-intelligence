"use client";

import { useEffect } from "react";

function normalize(value: string | null): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || null;
}

function addHelp(root: ParentNode) {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type='hidden']), select, textarea").forEach((field) => {
    if (field.title) return;
    const label = field.labels?.[0];
    const description =
      normalize(field.getAttribute("aria-label")) ??
      normalize(field.getAttribute("placeholder")) ??
      normalize(label?.textContent ?? null) ??
      normalize(field.getAttribute("name"));
    if (description) field.title = `Função deste campo: ${description}.`;
  });
}

/** Garante ajuda por hover também nos formulários antigos que ainda usam elementos HTML nativos. */
export function AutomaticFieldHelp() {
  useEffect(() => {
    addHelp(document);
    const observer = new MutationObserver(() => addHelp(document));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
