"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { centsToDisplay } from "@/lib/money";
import { listSavingsSuggestionsAction, getRealizedSavingsAction } from "@/actions/savings";
import type { SavingsSuggestionRecord } from "@/queries/savings";
import type { RealizedSavings } from "@/lib/ai/savings/realized";
import type { SavingsScopeType } from "@/db/schema";

const STATUS_LABEL: Record<SavingsSuggestionRecord["status"], string> = {
  new: "Checked",
  dismissed: "Dismissed",
  acted: "Acted on",
};

function relativeDays(date: Date): string {
  const days = Math.round((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function RealizedSavingsRow({ suggestionId }: { suggestionId: string }) {
  const [realized, setRealized] = useState<RealizedSavings[] | null>(null);
  const [isPending, startTransition] = useTransition();

  if (realized === null) {
    return (
      <Button
        size="sm"
        variant="link"
        className="h-auto p-0 text-xs"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await getRealizedSavingsAction(suggestionId);
            setRealized("error" in res ? [] : res);
          })
        }
      >
        Show realized savings
      </Button>
    );
  }

  const totalRealized = realized.reduce((sum, r) => sum + r.realizedCents, 0);
  return (
    <p className="text-xs text-muted-foreground">
      Realized so far: <span className="font-medium text-foreground">{centsToDisplay(totalRealized)}</span>
    </p>
  );
}

interface SavingsHistoryListProps {
  scope: { type: SavingsScopeType; id?: string };
  refreshKey: number;
  currentSuggestionId: string | null;
}

export function SavingsHistoryList({ scope, refreshKey, currentSuggestionId }: SavingsHistoryListProps) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<SavingsSuggestionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listSavingsSuggestionsAction(scope).then((res) => {
      if (cancelled) return;
      setRecords("error" in res ? [] : res);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refreshKey]);

  const previous = records.filter((r) => r.id !== currentSuggestionId);

  return (
    <div className="border-t pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Previous checks
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {!loaded && <p className="text-xs text-muted-foreground">Loading…</p>}
          {loaded && previous.length === 0 && (
            <p className="text-xs text-muted-foreground">No earlier checks for this scope.</p>
          )}
          {previous.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-2 text-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{relativeDays(r.createdAt)}</span>
                  <Badge variant={r.status === "acted" ? "default" : "outline"} className="text-[10px] h-4">
                    {STATUS_LABEL[r.status]}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {r.suggestions.length} suggestion{r.suggestions.length === 1 ? "" : "s"}
                </p>
                {r.status === "acted" && <RealizedSavingsRow suggestionId={r.id} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
