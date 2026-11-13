import { NextRequest, NextResponse } from "next/server";
import { getHouseholdId } from "@/lib/auth/session";
import { getNetWorthHistory, getCashFlow } from "@/queries/dashboard";
import { rangeToMonths } from "@/lib/date-utils";
import { withHousehold } from "@/lib/household-context";

// "All" (capital) matches DateRangeSelector's values on the client.
const VALID_RANGES = ["1M", "3M", "6M", "1Y", "All"] as const;
type Range = (typeof VALID_RANGES)[number];

const VALID_METRICS = ["net-worth", "income", "expenses"] as const;
type Metric = (typeof VALID_METRICS)[number];

function isValidRange(value: string): value is Range {
  return (VALID_RANGES as readonly string[]).includes(value);
}

function isValidMetric(value: string): value is Metric {
  return (VALID_METRICS as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const householdId = await getHouseholdId();
  const rawRange = request.nextUrl.searchParams.get("range") ?? "6M";
  const range: Range = isValidRange(rawRange) ? rawRange : "6M";
  const rawMetric = request.nextUrl.searchParams.get("metric") ?? "net-worth";
  const metric: Metric = isValidMetric(rawMetric) ? rawMetric : "net-worth";

  if (metric === "net-worth") {
    // Full NetWorthPoint[] (with coverage counts) — the hero needs them to mark
    // partial-history stretches.
    return NextResponse.json(await getNetWorthHistory(householdId, range === "All" ? "all" : range));
  }

  // Income/expenses are monthly totals, so the range is read as a month count.
  // getCashFlow reads `transactions`, which has row-level security.
  const cashFlow = await withHousehold(householdId, (tx) =>
    getCashFlow(householdId, rangeToMonths(range), tx),
  );
  return NextResponse.json(
    cashFlow.map((row) => ({ date: row.month, value: metric === "income" ? row.income : row.expenses }))
  );
}
