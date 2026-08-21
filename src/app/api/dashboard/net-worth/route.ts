import { NextRequest, NextResponse } from "next/server";
import { getHouseholdId } from "@/lib/auth/session";
import { getNetWorthHistory, getCashFlow } from "@/queries/dashboard";
import { rangeToMonths } from "@/lib/date-utils";

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
    const history = await getNetWorthHistory(householdId, range === "All" ? "all" : range);
    return NextResponse.json(history.map((p) => ({ date: p.date, value: p.netWorth })));
  }

  const cashFlow = await getCashFlow(householdId, rangeToMonths(range));
  return NextResponse.json(
    cashFlow.map((row) => ({ date: row.month, value: metric === "income" ? row.income : row.expenses }))
  );
}
