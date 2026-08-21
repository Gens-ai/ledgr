"use client";

import { PenLine, Trash2 } from "lucide-react";
import { CategoryIconTile } from "@/components/atoms/category-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CategoryOption } from "@/queries/categories";

interface CategoryRowProps {
  category: CategoryOption;
  onEdit: () => void;
  onDelete: () => void;
}

export function CategoryRow({ category, onEdit, onDelete }: CategoryRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <CategoryIconTile name={category.icon} className="size-7" />
      <span className="flex-1 truncate text-sm">{category.name}</span>
      {category.isIncome && (
        <Badge variant="secondary" className="text-xs">
          Income
        </Badge>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        aria-label={`Edit ${category.name}`}
        onClick={onEdit}
      >
        <PenLine className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${category.name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
