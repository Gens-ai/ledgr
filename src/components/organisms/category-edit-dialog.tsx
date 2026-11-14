"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { updateCategory, updateCategoryTransferIncome } from "@/actions/categories";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CategoryEditDialogProps {
  category: {
    id: string;
    name: string;
    groupId: string;
    isIncome: boolean;
    isSystem: boolean;
    includeTransferCreditsAsIncome: boolean;
  };
  groups: { id: string; name: string }[];
  disabled?: boolean;
  onError: (message: string) => void;
  onSaved: () => void;
}

/**
 * Fork: move a category to another group, flip whether it is an income
 * category, and (custom non-income categories) count incoming transfers as
 * income — an owner's draw (ISSUE-011). Name and icon are edited inline on the
 * row.
 */
export function CategoryEditDialog({
  category,
  groups,
  disabled,
  onError,
  onSaved,
}: CategoryEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState(category.groupId);
  const [isIncome, setIsIncome] = useState(category.isIncome);
  const [transferCredits, setTransferCredits] = useState(category.includeTransferCreditsAsIncome);
  const [pending, startTransition] = useTransition();
  // Same eligibility the action enforces (updateCategoryTransferIncomeScoped).
  const transferCreditsEligible = !category.isSystem && !isIncome;

  function handleOpenChange(next: boolean) {
    if (next) {
      setGroupId(category.groupId);
      setIsIncome(category.isIncome);
      setTransferCredits(category.includeTransferCreditsAsIncome);
    }
    setOpen(next);
  }

  function save() {
    startTransition(async () => {
      const result = await updateCategory(category.id, { groupId, isIncome });
      if ("error" in result) {
        onError(result.error);
        return;
      }
      // Becoming income clears the flag server-side; only send it when it can apply.
      if (transferCreditsEligible && transferCredits !== category.includeTransferCreditsAsIncome) {
        const flagResult = await updateCategoryTransferIncome(category.id, transferCredits);
        if ("error" in flagResult) {
          onError(flagResult.error);
          return;
        }
      }
      setOpen(false);
      onSaved();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Edit ${category.name}`}
        disabled={disabled}
        onClick={() => handleOpenChange(true)}
      >
        <SlidersHorizontal className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {category.name}</DialogTitle>
            <DialogDescription>
              Move the category to another group or change how it counts toward income.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`category-group-${category.id}`}>Group</Label>
              <Select
                value={groupId}
                onValueChange={(value) => {
                  if (value !== null) setGroupId(value);
                }}
              >
                <SelectTrigger id={`category-group-${category.id}`} className="w-full" aria-label="Group">
                  <SelectValue>{groups.find((g) => g.id === groupId)?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isIncome} onCheckedChange={setIsIncome} aria-label="Income category" />
              Income category
            </label>
            {isIncome && !category.isIncome && (
              <p className="text-xs text-muted-foreground">
                Income categories never count transfers as spending, so that setting is turned off.
              </p>
            )}
            {!category.isSystem && (
              <div className="grid gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={transferCreditsEligible && transferCredits}
                    onCheckedChange={setTransferCredits}
                    disabled={!transferCreditsEligible}
                    aria-label="Count incoming transfers as income"
                  />
                  Count incoming transfers as income
                </label>
                <p className="text-xs text-muted-foreground">
                  For an owner&apos;s draw: money moved from a business account into a personal one
                  counts as income in your totals. The outgoing side is never counted as spending, so
                  this turns off &ldquo;Count transfers as spending&rdquo;.
                  {isIncome && " Not available for income categories."}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
