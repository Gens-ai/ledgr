"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertCircle, Loader2, RefreshCw, Sparkles, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { SavingsSuggestionCard } from "@/components/molecules/savings-suggestion-card";
import { SavingsHistoryList } from "@/components/molecules/savings-history-list";
import {
  getSavingsSuggestionsAction,
  dismissSavingsSuggestionAction,
  markSavingsSuggestionActedAction,
  getDealsSettingsAction,
} from "@/actions/savings";
import type { GetSavingsSuggestionsResult } from "@/lib/ai/savings/advisor";
import type { SavingsScopeType } from "@/db/schema";

interface SavingsAdvisorPanelProps {
  scope: { type: SavingsScopeType; id?: string };
  active: boolean;
}

type RunStatus = "idle" | "loading" | "ready" | "error";

export function SavingsAdvisorPanel({ scope, active }: SavingsAdvisorPanelProps) {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<GetSavingsSuggestionsResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dealsAvailable, setDealsAvailable] = useState(false);
  const [includeDeals, setIncludeDeals] = useState(false);
  const [suggestionState, setSuggestionState] = useState<"new" | "dismissed" | "acted">("new");
  const [historyKey, setHistoryKey] = useState(0);
  const [isPending, startTransition] = useTransition();
  const hasAutoRunRef = useRef(false);

  function run(deals: boolean) {
    setStatus("loading");
    setErrorMsg(null);
    startTransition(async () => {
      const res = await getSavingsSuggestionsAction({ scope, includeDeals: deals });
      if ("error" in res) {
        setErrorMsg(res.error);
        setStatus("error");
        return;
      }
      setResult(res);
      setSuggestionState("new");
      setStatus("ready");
      setHistoryKey((k) => k + 1);
    });
  }

  useEffect(() => {
    if (!active) {
      hasAutoRunRef.current = false;
      return;
    }
    // Guards against React Strict Mode's dev-only double-invocation of this
    // effect, which otherwise fires two concurrent getSavingsSuggestionsAction
    // calls — the second one lands after the first has already persisted a
    // row, hits the rate limit, and its error state clobbers the first
    // call's real results.
    if (hasAutoRunRef.current || status !== "idle") return;
    hasAutoRunRef.current = true;
    // Deferred to a microtask so the initial fetch's setState isn't called
    // synchronously from the effect body itself (react-hooks/set-state-in-effect).
    Promise.resolve().then(() => run(false));
    getDealsSettingsAction().then((res) => {
      if (!("error" in res)) setDealsAvailable(res.enabled);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function handleDismiss() {
    if (!result) return;
    setSuggestionState("dismissed");
    startTransition(async () => {
      await dismissSavingsSuggestionAction(result.suggestionId);
      setHistoryKey((k) => k + 1);
    });
  }

  function handleAct() {
    if (!result) return;
    setSuggestionState("acted");
    startTransition(async () => {
      await markSavingsSuggestionActedAction(result.suggestionId);
      setHistoryKey((k) => k + 1);
    });
  }

  return (
    <div className="space-y-4">
      {status === "loading" && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {status === "ready" && result && (
        <div className="space-y-3">
          {result.dealsIncluded && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" />
              Includes deals found via web search
            </p>
          )}

          {result.suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Nothing specific to suggest here right now — either spending in this scope is already lean, or
              there isn&apos;t enough history yet.
            </p>
          ) : (
            <div className="space-y-2">
              {result.suggestions.map((s, i) => (
                <SavingsSuggestionCard key={i} suggestion={s} />
              ))}
            </div>
          )}

          {result.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                variant={suggestionState === "acted" ? "default" : "outline"}
                disabled={isPending || suggestionState === "acted"}
                onClick={handleAct}
              >
                <ThumbsUp />
                {suggestionState === "acted" ? "Marked as acted on" : "I'll do this"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending || suggestionState === "dismissed"}
                onClick={handleDismiss}
              >
                <X />
                {suggestionState === "dismissed" ? "Dismissed" : "Not now"}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            {dealsAvailable ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={includeDeals}
                  onCheckedChange={(v) => setIncludeDeals(v === true)}
                  disabled={isPending}
                />
                Also search the web for deals
              </label>
            ) : (
              <span />
            )}
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => run(includeDeals)}>
              {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Check again
            </Button>
          </div>
        </div>
      )}

      <SavingsHistoryList scope={scope} refreshKey={historyKey} currentSuggestionId={result?.suggestionId ?? null} />
    </div>
  );
}
