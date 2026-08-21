"use client";

import { useState, useTransition } from "react";
import { NetWorthAreaChart } from "@/components/atoms/net-worth-area-chart";
import { DateRangeSelector } from "@/components/molecules/date-range-selector";
import { MetricSelector, type Metric } from "@/components/molecules/metric-selector";
import { centsToDisplay } from "@/lib/money";
import { trendDelta } from "@/lib/stat-delta";
import { formatDateShort, formatMonthShort } from "@/lib/date-utils";
import { INCOME_COLOR, EXPENSE_COLOR, POSITIVE_COLOR } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import type { NetWorthPoint } from "@/queries/dashboard";

const RANGE_LABELS: Record<string, string> = {
  "1M": "past month",
  "3M": "past 3 months",
  "6M": "past 6 months",
  "1Y": "past year",
  All: "all time",
};

const METRIC_LABELS: Record<Metric, string> = {
  "net-worth": "Net worth",
  income: "Income",
  expenses: "Expenses",
};

const METRIC_COLORS: Record<Metric, string> = {
  "net-worth": POSITIVE_COLOR,
  income: INCOME_COLOR,
  expenses: EXPENSE_COLOR,
};

// For net worth and income, going up is good (green); for expenses, going
// up is bad — flip which direction reads as positive without changing the
// arrow, which always reflects the actual direction of change.
const HIGHER_IS_BETTER: Record<Metric, boolean> = {
  "net-worth": true,
  income: true,
  expenses: false,
};

interface Point {
  date: string;
  value: number;
}

interface NetWorthHeroProps {
  netWorth: number;
  initialHistory: NetWorthPoint[];
  initialRange?: string;
}

export function NetWorthHero({ netWorth, initialHistory, initialRange = "6M" }: NetWorthHeroProps) {
  const [range, setRange] = useState(initialRange);
  const [metric, setMetric] = useState<Metric>("net-worth");
  const [points, setPoints] = useState<Point[]>(
    initialHistory.map((p) => ({ date: p.date, value: p.netWorth })),
  );
  const [isLoading, startTransition] = useTransition();

  const delta = trendDelta(points.map((p) => p.value));
  const displayValue = metric === "net-worth" ? netWorth : (points[points.length - 1]?.value ?? 0);
  const [dollars, cents] = centsToDisplay(displayValue).split(".");
  const isGoodDirection = delta && (HIGHER_IS_BETTER[metric] ? delta.diff >= 0 : delta.diff <= 0);

  function fetchPoints(nextRange: string, nextMetric: Metric) {
    startTransition(async () => {
      const res = await fetch(`/api/dashboard/net-worth?range=${nextRange}&metric=${nextMetric}`);
      setPoints(await res.json());
    });
  }

  function handleRangeChange(next: string) {
    setRange(next);
    fetchPoints(next, metric);
  }

  function handleMetricChange(next: Metric) {
    setMetric(next);
    fetchPoints(range, next);
  }

  return (
    <section aria-label="Financial trends" className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <MetricSelector value={metric} onChange={handleMetricChange} />
          <div className="flex flex-wrap items-baseline gap-3 mt-1.5">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {dollars}
              {cents !== undefined && (
                <span className="text-2xl text-muted-foreground font-medium">.{cents}</span>
              )}
            </span>
            {delta && (
              <span
                className={cn(
                  "text-sm font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap",
                  isGoodDirection
                    ? "text-positive bg-positive/10"
                    : "text-destructive bg-destructive/10",
                )}
              >
                {delta.diff >= 0 ? "↑" : "↓"} {centsToDisplay(Math.abs(delta.diff))}
                {delta.pct !== null && ` (${Math.abs(delta.pct).toFixed(1)}%)`}{" "}
                <span className="font-medium opacity-75">
                  {RANGE_LABELS[range] ?? range.toLowerCase()}
                </span>
              </span>
            )}
          </div>
        </div>
        <DateRangeSelector value={range} onChange={handleRangeChange} />
      </div>
      <div className={cn("h-56 mt-3 transition-opacity", isLoading && "opacity-50")}>
        <NetWorthAreaChart
          mode="single"
          seriesName={METRIC_LABELS[metric]}
          color={METRIC_COLORS[metric]}
          dateFormatter={metric === "net-worth" ? formatDateShort : formatMonthShort}
          emptyMessage={`${METRIC_LABELS[metric]} history will appear after your accounts sync.`}
          data={points}
        />
      </div>
    </section>
  );
}
