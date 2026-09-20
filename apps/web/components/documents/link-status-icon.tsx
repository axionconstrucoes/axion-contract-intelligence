import { Link2, Unlink2 } from "lucide-react";
import type { LinkStatus } from "@/lib/documents/link-status-appearance";

// Glifo do estado do vínculo — corrente fechada (vinculado) / corrente
// rompida (desvinculado). Só o desenho; a cor vem do gatilho que o
// envolve (ver getLinkStatusAppearance), para que glifo e cor sigam
// SEMPRE o mesmo estado e nunca possam divergir.
export function LinkStatusIcon({ status, className = "h-5 w-5" }: { status: LinkStatus; className?: string }) {
  const Icon = status === "linked" ? Link2 : Unlink2;
  return <Icon className={className} aria-hidden="true" data-link-status={status} />;
}
