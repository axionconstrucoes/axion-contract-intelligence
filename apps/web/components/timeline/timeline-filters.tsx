"use client";

import type { ImplicationCategory, SourceType } from "@axion/types";
import { Select } from "@/components/ui/select";
import { categoryLabels, sourceTypeShortLabels } from "@/lib/labels";

const sourceTypes = Object.keys(sourceTypeShortLabels) as SourceType[];
const categories = Object.keys(categoryLabels) as ImplicationCategory[];

export function TimelineFilters({
  source,
  category,
  onSourceChange,
  onCategoryChange,
}: {
  source: string;
  category: string;
  onSourceChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <Select value={source} onChange={(e) => onSourceChange(e.target.value)}>
        <option value="">Todas as fontes</option>
        {sourceTypes.map((s) => (
          <option key={s} value={s}>
            {sourceTypeShortLabels[s]}
          </option>
        ))}
      </Select>
      <Select value={category} onChange={(e) => onCategoryChange(e.target.value)}>
        <option value="">Todas as categorias</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {categoryLabels[c]}
          </option>
        ))}
      </Select>
    </div>
  );
}
