"use client";

import { Plus, PenLine, Trash2 } from "lucide-react";
import { CategoryIconTile } from "@/components/atoms/category-icon";
import { Button } from "@/components/ui/button";

interface CategoryGroupHeaderProps {
  name: string;
  icon: string | null;
  categoryCount: number;
  onAddCategory: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function CategoryGroupHeader({
  name,
  icon,
  categoryCount,
  onAddCategory,
  onEdit,
  onDelete,
}: CategoryGroupHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <CategoryIconTile name={icon} className="size-8" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{name}</h2>
        <p className="text-xs text-muted-foreground">
          {categoryCount} {categoryCount === 1 ? "category" : "categories"}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onAddCategory}>
        <Plus className="size-3.5" />
        Add category
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        aria-label={`Edit ${name} group`}
        onClick={onEdit}
      >
        <PenLine className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${name} group`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
