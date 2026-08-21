"use client";

import { useState, useEffect, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteCategory, getCategoryUsageAction } from "@/actions/categories";
import type { CategoryUsage } from "@/queries/categories";

interface ReplacementOption {
  id: string;
  name: string;
  groupName: string;
}

interface DeleteCategoryDialogProps {
  category: { id: string; name: string } | null;
  replacementOptions: ReplacementOption[];
  onClose: () => void;
}

const EMPTY_USAGE: CategoryUsage = {
  transactions: 0,
  transactionSplits: 0,
  recurringTransactions: 0,
  merchants: 0,
  categoryRules: 0,
  budgetCategories: 0,
};

function usageLabel(usage: CategoryUsage): string {
  const parts: string[] = [];
  const push = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  push(usage.transactions, "transaction", "transactions");
  push(usage.transactionSplits, "split", "splits");
  push(usage.recurringTransactions, "recurring bill", "recurring bills");
  push(usage.merchants, "merchant default", "merchant defaults");
  push(usage.categoryRules, "rule", "rules");
  push(usage.budgetCategories, "budget line", "budget lines");
  return parts.join(", ");
}

export function DeleteCategoryDialog({ category, replacementOptions, onClose }: DeleteCategoryDialogProps) {
  const [usage, setUsage] = useState<CategoryUsage | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const loadingUsage = category !== null && usage === null;

  useEffect(() => {
    if (!category) return;
    let cancelled = false;
    getCategoryUsageAction(category.id).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
        setUsage(EMPTY_USAGE);
      } else {
        setUsage(result.usage);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [category]);

  function handleOpenChange(open: boolean) {
    if (!open) onClose();
  }

  const totalUsage = usage ? Object.values(usage).reduce((a, b) => a + b, 0) : 0;
  const needsReplacement = totalUsage > 0;
  const options = replacementOptions.filter((o) => o.id !== category?.id);

  function handleConfirm() {
    if (!category || pending) return;
    if (needsReplacement && !replacementId) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCategory(category.id, needsReplacement ? replacementId : undefined);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <AlertDialog open={category !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{category?.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            {loadingUsage
              ? "Checking usage…"
              : needsReplacement
                ? `This category is used by ${usageLabel(usage!)}. Choose a category to move them to before deleting.`
                : "This category isn't used anywhere. It can be deleted directly."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsReplacement && !loadingUsage && (
          <div className="grid gap-2 text-left">
            <Label htmlFor="replacement-category">Reassign to</Label>
            <Select value={replacementId} onValueChange={(v) => { if (v !== null) setReplacementId(v); }}>
              <SelectTrigger id="replacement-category">
                <SelectValue>
                  {(() => {
                    const selected = options.find((o) => o.id === replacementId);
                    return selected ? `${selected.groupName} / ${selected.name}` : "Choose a category";
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.groupName} / {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {error && (
          <p role="alert" className="text-left text-sm text-destructive">{error}</p>
        )}

        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || loadingUsage || (needsReplacement && !replacementId)}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
