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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryIcon, CATEGORY_ICON_NAMES } from "@/components/atoms/category-icon";
import { createCategoryGroup, updateCategoryGroup } from "@/actions/categories";

export type CategoryGroupDialogState =
  | { mode: "add" }
  | { mode: "edit"; group: { id: string; name: string; icon: string | null } }
  | null;

interface CategoryGroupDialogProps {
  state: CategoryGroupDialogState;
  onClose: () => void;
}

export function CategoryGroupDialog({ state, onClose }: CategoryGroupDialogProps) {
  const [name, setName] = useState(state?.mode === "edit" ? state.group.name : "");
  const [icon, setIcon] = useState(
    state?.mode === "edit" ? state.group.icon ?? CATEGORY_ICON_NAMES[0] : CATEGORY_ICON_NAMES[0],
  );
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
          ? await updateCategoryGroup(state.group.id, { name, icon })
          : await createCategoryGroup({ name, icon });

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
          <DialogTitle>{state?.mode === "edit" ? "Edit Group" : "Add Group"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="group-icon">Icon</Label>
            <Select value={icon} onValueChange={(v) => { if (v !== null) setIcon(v); }}>
              <SelectTrigger id="group-icon">
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
