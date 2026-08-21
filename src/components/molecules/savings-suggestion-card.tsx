import { Clock, TrendingDown, Repeat, RefreshCw, Tags, ArrowLeftRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { centsToDisplay } from "@/lib/money";
import type { SavingsSuggestion, SavingsSuggestionKind } from "@/lib/ai/savings/types";

const KIND_META: Record<SavingsSuggestionKind, { label: string; icon: typeof TrendingDown }> = {
  substitution: { label: "Swap", icon: ArrowLeftRight },
  reduction: { label: "Cut back", icon: TrendingDown },
  cancellation: { label: "Cancel", icon: Repeat },
  switch_provider: { label: "Switch provider", icon: RefreshCw },
  timing: { label: "Timing", icon: Clock },
  deal: { label: "Deal", icon: Tags },
};

interface SavingsSuggestionCardProps {
  suggestion: SavingsSuggestion;
}

export function SavingsSuggestionCard({ suggestion }: SavingsSuggestionCardProps) {
  const kind = KIND_META[suggestion.kind];
  const KindIcon = kind.icon;
  const lowConfidence = suggestion.confidence < 0.5;

  return (
    <div className="rounded-lg border p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-snug">{suggestion.title}</p>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            ~{centsToDisplay(suggestion.estMonthlySavingsCents)}/mo
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.detail}</p>
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <Badge variant="outline" className="gap-1">
          <KindIcon />
          {kind.label}
        </Badge>
        <Badge variant="outline">{suggestion.effort} effort</Badge>
        {suggestion.timeCostMinutes !== null && (
          <Badge variant="outline" className="gap-1">
            <Clock />
            ~{suggestion.timeCostMinutes} min
          </Badge>
        )}
        {lowConfidence && (
          <Badge variant="secondary" className="gap-1">
            <Sparkles />
            rough estimate
          </Badge>
        )}
      </div>
    </div>
  );
}
