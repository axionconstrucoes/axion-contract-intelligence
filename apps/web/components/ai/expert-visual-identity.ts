import { CalendarClock, Crown, Leaf, Scale, TrendingUp, type LucideIcon } from "lucide-react";
import type { ExpertVisualIdentity } from "../../lib/ai/expert-definitions";
import { cn } from "../../lib/utils";

// Resolve ExpertVisualIdentity (dado puro, sem React — ver
// expert-definitions/types.ts) para componentes reais. Classes Tailwind
// sempre literais aqui (nunca `text-${color}-600` interpolado) para o
// JIT do Tailwind sempre encontrar a classe.

const ICONS_BY_NAME: Record<string, LucideIcon> = {
  Crown,
  TrendingUp,
  Scale,
  CalendarClock,
  Leaf,
};

export function resolveExpertIcon(identity: ExpertVisualIdentity): LucideIcon {
  return ICONS_BY_NAME[identity.icon] ?? Crown;
}

const TEXT_CLASSES: Record<ExpertVisualIdentity["colorToken"], string> = {
  purple: "text-purple-600 dark:text-purple-400",
  blue: "text-blue-600 dark:text-blue-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  green: "text-green-600 dark:text-green-400",
};

const BORDER_CLASSES: Record<ExpertVisualIdentity["colorToken"], string> = {
  purple: "border-l-purple-500",
  blue: "border-l-blue-500",
  indigo: "border-l-indigo-500",
  cyan: "border-l-cyan-500",
  green: "border-l-green-500",
};

export function expertIconClassName(identity: ExpertVisualIdentity, extra?: string): string {
  return cn(TEXT_CLASSES[identity.colorToken], extra);
}

/** Faixa/borda discreta à esquerda do card — nunca a mesma paleta de severidade/risco. */
export function expertAccentBorderClassName(identity: ExpertVisualIdentity): string {
  return cn("border-l-4", BORDER_CLASSES[identity.colorToken]);
}
