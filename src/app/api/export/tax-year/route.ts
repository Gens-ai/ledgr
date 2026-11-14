import { NextRequest } from "next/server";
import { z } from "zod";
import { getHouseholdId } from "@/lib/auth/session";
import { withHousehold } from "@/lib/household-context";
import { db as defaultDb, type LedgrDb } from "@/db";
import { csvCents, csvDocumentBytes, csvDownloadResponse, csvRow } from "@/lib/csv";
import { parseGroupFilterParams, type GroupFilter } from "@/lib/group-filter";
import { getTaxYearExport } from "@/queries/tax-export";

/**
 * Tax-year export (fork, 2026-11-14): one calendar year, optionally narrowed
 * by category group, as either per-category totals or every transaction behind
 * them. See `getTaxYearExport` for the classification rules.
 *
 * GET /api/export/tax-year?year=2025&kind=totals|transactions[&groups=a,b&groupMode=exclude]
 */

const querySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200),
  kind: z.enum(["totals", "transactions"]),
});

type TaxYearCsvOptions = GroupFilter & z.infer<typeof querySchema>;

export async function buildTaxYearCsv(
  householdId: string,
  options: TaxYearCsvOptions,
  db: LedgrDb = defaultDb,
): Promise<string> {
  const { totals, transactions } = await getTaxYearExport(householdId, options, db);

  if (options.kind === "totals") {
    const income = totals.reduce((s, t) => s + t.income, 0);
    const expenses = totals.reduce((s, t) => s + t.expenses, 0);
    const count = totals.reduce((s, t) => s + t.count, 0);
    return [
      "Group,Category,Income,Expenses,Transactions",
      ...totals.map((t) =>
        csvRow([
          t.groupName ?? "",
          t.categoryName,
          { raw: csvCents(t.income) },
          { raw: csvCents(t.expenses) },
          { raw: String(t.count) },
        ]),
      ),
      csvRow(["Total", "", { raw: csvCents(income) }, { raw: csvCents(expenses) }, { raw: String(count) }]),
    ].join("\n") + "\n";
  }

  return [
    "Date,Account,Description,Category,Group,Type,Amount,Notes",
    ...transactions.map((t) =>
      csvRow([
        t.date,
        t.accountName,
        t.description,
        t.categoryName,
        t.groupName ?? "",
        t.side === "income" ? "Income" : "Expense",
        { raw: csvCents(t.amount) },
        t.notes ?? "",
      ]),
    ),
  ].join("\n") + "\n";
}

export async function GET(request: NextRequest) {
  // Auth first, as the transactions export does: an anonymous request learns nothing.
  const householdId = await getHouseholdId();
  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({ year: sp.get("year"), kind: sp.get("kind") });
  if (!parsed.success) {
    return new Response("Invalid year or export kind", { status: 400 });
  }

  const options: TaxYearCsvOptions = {
    ...parsed.data,
    ...parseGroupFilterParams(sp.get("groups"), sp.get("groupMode")),
  };
  const csv = await withHousehold(householdId, (tx) => buildTaxYearCsv(householdId, options, tx));

  return csvDownloadResponse(
    csvDocumentBytes([csv.replace(/\n$/, "")]),
    `ledgr-tax-${options.year}-${options.kind}.csv`,
  );
}
