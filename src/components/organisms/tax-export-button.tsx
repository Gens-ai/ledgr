"use client";

import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { GroupFilterFields } from "@/components/molecules/group-filter-fields";
import { groupFilterParams, type GroupMode } from "@/lib/group-filter";

interface TaxExportButtonProps {
  groups: { id: string; name: string }[];
  /** The current calendar year; passed from the server so render is deterministic. */
  currentYear: number;
}

const YEARS_OFFERED = 7;

/** The download URL for one of the two tax-year files. */
export function taxExportHref(
  kind: "totals" | "transactions",
  year: number,
  groupIds: string[],
  mode: GroupMode,
): string {
  const params = new URLSearchParams({ year: String(year), kind });
  const { groups, groupMode } = groupFilterParams(groupIds, mode);
  if (groups) params.set("groups", groups);
  if (groupMode) params.set("groupMode", groupMode);
  return `/api/export/tax-year?${params.toString()}`;
}

/**
 * Tax-year export (fork): pick a calendar year and category groups, download
 * per-category totals and the transactions behind them as two CSVs. Its own
 * selection, independent of the report filters above, because a tax year is a
 * calendar year whatever range the report is showing.
 */
export function TaxExportButton({ groups, currentYear }: TaxExportButtonProps) {
  const [open, setOpen] = useState(false);
  // Tax prep is usually for the year just ended.
  const [year, setYear] = useState(currentYear - 1);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [mode, setMode] = useState<GroupMode>("include");
  const years = Array.from({ length: YEARS_OFFERED }, (_, i) => currentYear - i);

  function toggleGroup(id: string) {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="h-8 text-xs" />}>
        <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
        Tax export
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="end">
        <div className="space-y-1.5 p-3">
          <Label htmlFor="tax-export-year" className="text-xs">
            Tax year
          </Label>
          <Select
            value={String(year)}
            onValueChange={(v) => {
              if (v !== null) setYear(Number(v));
            }}
          >
            <SelectTrigger id="tax-export-year" className="w-full">
              <SelectValue>{String(year)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            January 1 – December 31. Settled, not hidden; transfers left out except owner&apos;s
            draws counted as income.
          </p>
        </div>
        <Separator />
        <div className="px-3 pt-2.5 text-xs font-medium text-muted-foreground">
          Groups {groupIds.length === 0 && <span className="font-normal">(all)</span>}
        </div>
        <GroupFilterFields
          groups={groups}
          selectedIds={groupIds}
          mode={mode}
          onToggle={toggleGroup}
          onModeChange={setMode}
        />
        <Separator />
        <div className="grid gap-2 p-3">
          {/* Plain links styled as buttons: a download is navigation, not an action. */}
          <a
            href={taxExportHref("totals", year, groupIds, mode)}
            download
            className={cn(buttonVariants({ size: "sm" }), "h-8 text-xs")}
          >
            <Download className="mr-1 h-3.5 w-3.5" /> Category totals (CSV)
          </a>
          <a
            href={taxExportHref("transactions", year, groupIds, mode)}
            download
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 text-xs")}
          >
            <Download className="mr-1 h-3.5 w-3.5" /> Transactions (CSV)
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
