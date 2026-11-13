"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { updateCategory } from "@/actions/categories";
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
  category: { id: string; name: string; groupId: string; isIncome: boolean };
  groups: { id: string; name: string }[];
  disabled?: boolean;
  onError: (message: string) => void;
  onSaved: () => void;
}

/**
 * Fork: move a category to another group and flip whether it is an income
 * category. Name and icon are edited inline on the row.
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
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next) {
      setGroupId(category.groupId);
      setIsIncome(category.isIncome);
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
              Move the category to another group or change whether it counts as income.
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
