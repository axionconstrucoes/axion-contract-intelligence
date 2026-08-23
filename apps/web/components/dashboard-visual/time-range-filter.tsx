"use client";

// Filtro temporal (seção 17) — navegação por querystring (?range=...),
// sem estado client além do form; server component recalcula tudo a
// partir de searchParams. Personalizado usa dois <input type="date">
// nativos, submetidos junto.

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FeatureInfo } from "@/components/shared/feature-info";
import { TIME_RANGE_OPTION_LABELS, type TimeRangeOption } from "@/lib/dashboard-visual/resolve-time-range";

const OPTIONS: TimeRangeOption[] = ["HOJE", "7D", "30D", "DESDE_INICIO", "PERSONALIZADO"];

export function TimeRangeFilter({ current, from, to }: { current: TimeRangeOption; from: string; to: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(next: { range?: string; from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.range) params.set("range", next.range);
    if (next.from !== undefined) params.set("from", next.from);
    if (next.to !== undefined) params.set("to", next.to);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        Período
        <FeatureInfo helpId="dashboard-visual-time-filter" />
      </span>
      <Select value={current} onChange={(e) => navigate({ range: e.target.value })} className="h-8 max-w-52 text-xs">
        {OPTIONS.map((option) => (
          <option key={option} value={option}>
            {TIME_RANGE_OPTION_LABELS[option]}
          </option>
        ))}
      </Select>
      {current === "PERSONALIZADO" ? (
        <span className="flex items-center gap-1.5">
          <Input type="date" defaultValue={from} onChange={(e) => navigate({ range: "PERSONALIZADO", from: e.target.value })} className="h-8 w-36 text-xs" />
          <span className="text-xs text-muted-foreground">até</span>
          <Input type="date" defaultValue={to} onChange={(e) => navigate({ range: "PERSONALIZADO", to: e.target.value })} className="h-8 w-36 text-xs" />
        </span>
      ) : null}
    </div>
  );
}
