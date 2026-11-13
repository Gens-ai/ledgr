"use client";

import { useState, useTransition, useMemo } from "react";
import { NetWorthAreaChart } from "@/components/atoms/net-worth-area-chart";
import { BalanceDisplay } from "@/components/atoms/balance-display";
import { DateRangeSelector } from "@/components/molecules/date-range-selector";
import { MetricSelector, type Metric } from "@/components/molecules/metric-selector";
import { centsToDisplay } from "@/lib/money";
import { trendDelta } from "@/lib/stat-delta";
import { formatDateShort, formatMonthShort } from "@/lib/date-utils";
import { INCOME_COLOR, EXPENSE_COLOR, POSITIVE_COLOR } from "@/lib/chart-colors";
import { coverageBoundary, coveredTrendDelta } from "@/lib/net-worth-coverage";
import { rangeSupport, RANGES } from "@/lib/net-worth-range";
import { cn } from "@/lib/utils";
import type { NetWorthPoint } from "@/queries/dashboard";

const RANGE_LABELS: Record<string, string> = {
  "1M": "past month",
  "3M": "past 3 months",
  "6M": "past 6 months",
  "1Y": "past year",
  All: "all time",
};

// Fork: the hero also shows monthly Income and Expenses totals. Net worth keeps
// upstream's coverage-aware treatment; the cash-flow metrics have no balance
// coverage to mark, so they plot plainly.
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

// Going up is good for net worth and income, bad for expenses. The arrow always
// shows the actual direction; only the colour flips.
const HIGHER_IS_BETTER: Record<Metric, boolean> = {
  "net-worth": true,
  income: true,
  expenses: false,
};

interface CashFlowPoint {
  date: string;
  value: number;
}

interface NetWorthHeroProps {
  netWorth: number;
  /** Signed totals behind `netWorth`; liabilities arrive negative. */
  assets: number;
  liabilities: number;
  initialHistory: NetWorthPoint[];
  initialRange?: string;
  /**
   * Date from which every account has a known balance, or null when history is
   * complete. Drives which ranges the control offers — see lib/net-worth-range.
   */
  fullCoverageSince?: string | null;
}

export function NetWorthHero({
  netWorth,
  assets,
  liabilities,
  initialHistory,
  initialRange,
  fullCoverageSince = null,
}: NetWorthHeroProps) {
  // Availability is fixed for a given household, so it is computed once rather
  // than per render. `asOf` only needs day precision here.
  const support = useMemo(
    () => rangeSupport(fullCoverageSince, new Date()),
    [fullCoverageSince],
  );

  // Open on the widest range the data can actually answer. When nothing
  // qualifies — coverage began within the last month — fall back to the
  // narrowest, which still renders its uncovered stretch dashed and hatched.
  const defaultRange =
    initialRange ?? support.find((r) => r.recommended)?.range ?? RANGES[0];

  const [range, setRange] = useState<string>(defaultRange);
  const [history, setHistory] = useState(initialHistory);
  const [metric, setMetric] = useState<Metric>("net-worth");
  const [cashPoints, setCashPoints] = useState<CashFlowPoint[]>([]);
  const isNetWorth = metric === "net-worth";
  const [isLoading, startTransition] = useTransition();

  // When coverage began too recently for even the narrowest range, plotting the
  // window anyway spends almost the whole chart on a stretch that is not net
  // worth. Show the covered span instead — the pre-coverage points are dropped
  // rather than silently un-marked, so nothing partial is ever drawn unmarked,
  // and the note below still says what is missing.
  const noRangeFits = !support.some((r) => r.supported);
  const fullBoundary = coverageBoundary(history);
  const trimmed =
    noRangeFits && fullBoundary.hasPartial && fullBoundary.index > 0
      ? history.slice(fullBoundary.index)
      : history;

  // Measured across the fully covered span only. A delta from a partial
  // baseline reports accounts appearing, not money arriving — that is what
  // produced the "+2430.7% past 6 months" this replaces.
  const delta = isNetWorth
    ? coveredTrendDelta(history)
    : trendDelta(cashPoints.map((p) => p.value));
  const coverage = coverageBoundary(isNetWorth ? trimmed : []);
  const trimmedTo = isNetWorth && trimmed !== history ? fullBoundary : null;
  const displayValue = isNetWorth ? netWorth : (cashPoints[cashPoints.length - 1]?.value ?? 0);
  const [dollars, cents] = centsToDisplay(displayValue).split(".");
  const hasPosition = isNetWorth && (assets !== 0 || liabilities !== 0);
  const isGoodDirection = delta && (HIGHER_IS_BETTER[metric] ? delta.diff > 0 : delta.diff < 0);

  function fetchPoints(nextRange: string, nextMetric: Metric) {
    startTransition(async () => {
      const res = await fetch(`/api/dashboard/net-worth?range=${nextRange}&metric=${nextMetric}`);
      const json = await res.json();
      if (nextMetric === "net-worth") setHistory(json);
      else setCashPoints(json);
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
    <section aria-label={METRIC_LABELS[metric]} className="mb-6">
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
                  delta.diff === 0
                    ? "text-muted-foreground bg-muted"
                    : isGoodDirection
                      ? "text-positive bg-positive/10"
                      : "text-destructive bg-destructive/10",
                )}
              >
                {/* An arrow on a zero diff points somewhere the number doesn't. */}
                {delta.diff === 0 ? (
                  "No change"
                ) : (
                  <>
                    {delta.diff > 0 ? "↑" : "↓"} {centsToDisplay(Math.abs(delta.diff))}
                    {delta.pct !== null && ` (${Math.abs(delta.pct).toFixed(1)}%)`}
                  </>
                )}{" "}
                <span className="font-medium opacity-75">
                  {coverage.hasPartial
                    ? `since ${formatDateShort(coverage.date ?? "")}`
                    : (RANGE_LABELS[range] ?? range.toLowerCase())}
                </span>
              </span>
            )}
            {!delta && coverage.hasPartial && (
              <span className="text-sm font-medium rounded-full px-2.5 py-0.5 whitespace-nowrap text-muted-foreground bg-muted">
                {coverage.date
                  ? `full history since ${formatDateShort(coverage.date)}`
                  : "history incomplete"}
              </span>
            )}
            {/* The two sides of the number beside them, on the same row: net
                worth alone cannot tell a paid-off house from a leveraged
                brokerage account. No border or fill — these are its operands,
                not separate figures, and the hero keeps its height because the
                row already had the width. Hidden only when there is nothing to
                divide, so an empty household is not shown two zeroes. */}
            {hasPosition && (
              <dl className="flex items-baseline gap-6 sm:ml-3">
                {[
                  { label: "Assets", amount: assets },
                  { label: "Debts", amount: liabilities },
                ].map(({ label, amount }) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {label}
                    </dt>
                    <dd>
                      {/* BalanceDisplay, as the Accounts page totals its groups
                          with -- it already tints a negative, so debts read as
                          debts here without a second colour convention. */}
                      <BalanceDisplay amount={amount} size="md" className="font-semibold" />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
        {/* Range gating reflects balance-history coverage, which only net worth has. */}
        <DateRangeSelector
          value={range}
          onChange={handleRangeChange}
          support={isNetWorth ? support : undefined}
        />
      </div>
      <div className={cn("h-56 mt-3 transition-opacity", isLoading && "opacity-50")}>
        {isNetWorth ? (
          <NetWorthAreaChart
            mode="single"
            seriesName="Net worth"
            data={trimmed.map((p) => ({
              date: p.date,
              value: p.netWorth,
              coveredAccounts: p.coveredAccounts,
              totalAccounts: p.totalAccounts,
            }))}
          />
        ) : (
          <NetWorthAreaChart
            mode="single"
            seriesName={METRIC_LABELS[metric]}
            color={METRIC_COLORS[metric]}
            dateFormatter={formatMonthShort}
            emptyMessage={`${METRIC_LABELS[metric]} history will appear after your accounts sync.`}
            data={cashPoints}
          />
        )}
      </div>
      {trimmedTo && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing full history from {formatDateShort(trimmedTo.date ?? "")}. Earlier dates are
          omitted because only {trimmedTo.minCovered === trimmedTo.maxPartialCovered
            ? trimmedTo.minCovered
            : `${trimmedTo.minCovered}–${trimmedTo.maxPartialCovered}`}{" "}
          of {trimmedTo.totalAccounts} accounts had balance history then, so those totals are not
          net worth. Longer ranges unlock as history accumulates.
        </p>
      )}
      {coverage.hasPartial && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="inline-block h-0 w-5 shrink-0 border-t-2 border-dashed border-current"
          />
          <span>
            Dashed: {coverage.minCovered === coverage.maxPartialCovered
              ? coverage.minCovered
              : `${coverage.minCovered}–${coverage.maxPartialCovered}`}{" "}
            of {coverage.totalAccounts} accounts had balance history
            {coverage.date ? ` before ${formatDateShort(coverage.date)}` : ""}, so it is not
            yet net worth.
          </span>
        </p>
      )}
    </section>
  );
}
