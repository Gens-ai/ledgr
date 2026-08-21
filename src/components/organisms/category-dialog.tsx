"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryIcon, CATEGORY_ICON_NAMES } from "@/components/atoms/category-icon";
import { createCategory, updateCategory } from "@/actions/categories";

export type CategoryDialogState =
  | { mode: "add"; groupId: string }
  | {
      mode: "edit";
      category: { id: string; name: string; icon: string | null; isIncome: boolean; groupId: string };
    }
  | null;

interface CategoryDialogProps {
  state: CategoryDialogState;
  groups: { id: string; name: string }[];
  onClose: () => void;
}

export function CategoryDialog({ state, groups, onClose }: CategoryDialogProps) {
  const [name, setName] = useState(state?.mode === "edit" ? state.category.name : "");
  const [icon, setIcon] = useState(
    state?.mode === "edit" ? state.category.icon ?? CATEGORY_ICON_NAMES[0] : CATEGORY_ICON_NAMES[0],
  );
  const [groupId, setGroupId] = useState(
    state?.mode === "edit" ? state.category.groupId : state?.mode === "add" ? state.groupId : "",
  );
  const [isIncome, setIsIncome] = useState(state?.mode === "edit" ? state.category.isIncome : false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(open: boolean) {
    if (!open) onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result =
        state?.mode === "edit"
          ? await updateCategory(state.category.id, { name, icon, groupId, isIncome })
          : await createCategory({ groupId, name, icon, isIncome });

      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }

      onClose();
    });
  }

  return (
    <Dialog open={state !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit Category" : "Add Category"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="category-group">Group</Label>
            <Select value={groupId} onValueChange={(v) => { if (v !== null) setGroupId(v); }}>
              <SelectTrigger id="category-group">
                <SelectValue>{groups.find((g) => g.id === groupId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="category-icon">Icon</Label>
            <Select value={icon} onValueChange={(v) => { if (v !== null) setIcon(v); }}>
              <SelectTrigger id="category-icon">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <CategoryIcon name={icon} size={14} />
                    {icon}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ICON_NAMES.map((name) => (
                  <SelectItem key={name} value={name}>
                    <span className="flex items-center gap-2">
                      <CategoryIcon name={name} size={14} />
                      {name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="category-income">Income category</Label>
            <Switch id="category-income" checked={isIncome} onCheckedChange={setIsIncome} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
