"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteCategory, getCategoryUsageAction } from "@/actions/categories";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import type { CategoryUsage } from "@/queries/categories";

export interface ReplacementOption {
  id: string;
  name: string;
  groupName: string;
}

interface CategoryDeleteDialogProps {
  category: { id: string; name: string };
  replacementOptions: ReplacementOption[];
  disabled?: boolean;
  onDeleted: () => void;
}

export function usageLabel(usage: CategoryUsage): string {
  const parts: string[] = [];
  const push = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  push(usage.transactions, "transaction", "transactions");
  push(usage.transactionSplits, "split", "splits");
  push(usage.recurringTransactions, "recurring item", "recurring items");
  push(usage.merchants, "merchant default", "merchant defaults");
  push(usage.categoryRules, "rule", "rules");
  push(usage.budgetCategories, "budget line", "budget lines");
  return parts.join(", ");
}

/**
 * Fork: delete with reassignment. Opening the dialog counts what uses the
 * category; an unused one deletes directly, an in-use one needs a category to
 * move everything to first.
 */
export function CategoryDeleteDialog({
  category,
  replacementOptions,
  disabled,
  onDeleted,
}: CategoryDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<CategoryUsage | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const options = replacementOptions.filter((o) => o.id !== category.id);
  const total = usage ? Object.values(usage).reduce((a, b) => a + b, 0) : 0;
  const needsReplacement = total > 0;
  const loading = open && usage === null && error === null;

  function openDialog() {
    setOpen(true);
    setUsage(null);
    setReplacementId("");
    setError(null);
    // Not a transition: the dialog shows its own "Checking..." state, and
    // sharing a transition with delete would mislabel the button meanwhile.
    void getCategoryUsageAction(category.id).then((result) => {
      if ("error" in result) setError(result.error);
      else setUsage(result.usage);
    });
  }

  function confirm() {
    if (needsReplacement && !replacementId) return;
    setError(null);
    startDelete(async () => {
      const result = await deleteCategory(category.id, needsReplacement ? replacementId : undefined);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onDeleted();
    });
  }

  const selected = options.find((o) => o.id === replacementId);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 hover:text-destructive"
        aria-label={`Delete ${category.name}`}
        disabled={disabled}
        onClick={openDialog}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {category.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {loading
                ? "Checking where this category is used..."
                : needsReplacement
                  ? `This category is used by ${usageLabel(usage!)}. Choose a category to move them to; ${category.name} is deleted afterwards.`
                  : usage
                    ? "This category isn't used anywhere, so it can be deleted directly."
                    : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {needsReplacement && (
            <div className="grid gap-2">
              <Label htmlFor={`replacement-${category.id}`}>Move to</Label>
              <Select
                value={replacementId}
                onValueChange={(value) => {
                  if (value !== null) setReplacementId(value);
                }}
              >
                <SelectTrigger
                  id={`replacement-${category.id}`}
                  className="w-full"
                  aria-label="Move to category"
                >
                  <SelectValue placeholder="Choose a category">
                    {selected ? `${selected.groupName} / ${selected.name}` : "Choose a category"}
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
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={confirm}
              disabled={deleting || loading || usage === null || (needsReplacement && !replacementId)}
            >
              {deleting ? "Deleting..." : needsReplacement ? "Move and delete" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
