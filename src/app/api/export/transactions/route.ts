import { NextRequest } from "next/server";
import { getHouseholdId } from "@/lib/auth/session";
import { baseTransactionQuery } from "@/queries/transactions";
import { transactions } from "@/db/schema";
import { notDeleted, notHidden } from "@/lib/query-helpers";
import { desc, gte, lte, eq, like, isNull, type SQL } from "drizzle-orm";
import { db as defaultDb, type LedgrDb } from "@/db";
import { todayDateString } from "@/lib/date-utils";
import { withHousehold } from "@/lib/household-context";
import { csvCents, csvDocumentBytes, csvDownloadResponse, csvEscape } from "@/lib/csv";
import { parseGroupFilterParams } from "@/lib/group-filter";
import { resolveGroupFilter } from "@/queries/group-filter";

interface ExportFilters {
  from?: string;
  to?: string;
  account?: string;
  category?: string;
  q?: string;
  reviewed?: string;
  /** Category-group filter, as the Transactions page's `groups`/`groupMode` params. */
  groups?: string;
  groupMode?: string;
}

export async function buildCsvString(
  householdId: string,
  filters: ExportFilters,
  db: LedgrDb = defaultDb,
): Promise<string> {
  const conditions: (SQL | undefined)[] = [notDeleted(transactions), notHidden(transactions)];

  if (filters.from) conditions.push(gte(transactions.date, filters.from));
  if (filters.to) conditions.push(lte(transactions.date, filters.to));
  if (filters.account) conditions.push(eq(transactions.accountId, filters.account));
  if (filters.category) {
    if (filters.category === "uncategorized") {
      conditions.push(isNull(transactions.categoryId));
    } else {
      conditions.push(eq(transactions.categoryId, filters.category));
    }
  }
  if (filters.q) conditions.push(like(transactions.name, `%${filters.q}%`));
  if (filters.reviewed === "true") conditions.push(eq(transactions.reviewed, true));
  const groupFilter = await resolveGroupFilter(
    householdId,
    parseGroupFilterParams(filters.groups, filters.groupMode),
    db,
  );
  conditions.push(groupFilter.condition(transactions.categoryId));

  const base = baseTransactionQuery(db, householdId);
  const rows = await base
    .joins(db.select(base.select).from(base.from))
    .where(base.scoped.where(transactions, ...conditions))
    .orderBy(desc(transactions.date), desc(transactions.id));

  const header = "Date,Account,Merchant,Amount,Category,Category Group,Notes,Original Description";
  const dataRows = rows.map((row: (typeof rows)[0]) => {
    const amount = csvCents(row.normalizedAmount ?? 0);
    return [
      csvEscape(row.date),
      csvEscape(row.accountName ?? ""),
      csvEscape(row.merchantName ?? row.name ?? ""),
      amount,
      csvEscape(row.categoryName ?? ""),
      csvEscape(row.categoryGroupName ?? ""),
      csvEscape(row.notes ?? ""),
      csvEscape(row.originalName ?? ""),
    ].join(",");
  });

  return [header, ...dataRows].join("\n") + "\n";
}

export async function buildCsvResponse(
  householdId: string,
  filters: ExportFilters,
  db: LedgrDb = defaultDb,
): Promise<Response> {
  // Under withHousehold like every other transactions read (RLS pilot).
  const csv = await withHousehold(householdId, (tx) => buildCsvString(householdId, filters, tx), db);
  // buildCsvString already ends in a newline; csvDocumentBytes adds one per line.
  return csvDownloadResponse(
    csvDocumentBytes([csv.replace(/\n$/, "")]),
    `ledgr-transactions-${todayDateString()}.csv`,
  );
}

export async function GET(request: NextRequest) {
  const householdId = await getHouseholdId();
  const sp = request.nextUrl.searchParams;

  const filters: ExportFilters = {
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    account: sp.get("account") ?? undefined,
    category: sp.get("category") ?? undefined,
    q: sp.get("q") ?? undefined,
    reviewed: sp.get("reviewed") ?? undefined,
    groups: sp.get("groups") ?? undefined,
    groupMode: sp.get("groupMode") ?? undefined,
  };

  return buildCsvResponse(householdId, filters);
}
