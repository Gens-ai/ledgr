"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const METRICS = ["net-worth", "income", "expenses"] as const;
export type Metric = (typeof METRICS)[number];

const METRIC_LABELS: Record<Metric, string> = {
  "net-worth": "Net worth",
  income: "Income",
  expenses: "Expenses",
};

interface MetricSelectorProps {
  value: Metric;
  onChange: (metric: Metric) => void;
}

export function MetricSelector({ value, onChange }: MetricSelectorProps) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(values) => {
        const next = values[0] as Metric | undefined;
        if (next) onChange(next);
      }}
      size="sm"
    >
      {METRICS.map((metric) => (
        <ToggleGroupItem key={metric} value={metric} className="text-xs px-2">
          {METRIC_LABELS[metric]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
