"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CategoryGroupHeader } from "@/components/molecules/category-group-header";
import { CategoryRow } from "@/components/molecules/category-row";
import { CategoryGroupDialog, type CategoryGroupDialogState } from "@/components/organisms/category-group-dialog";
import { CategoryDialog, type CategoryDialogState } from "@/components/organisms/category-dialog";
import { DeleteCategoryDialog } from "@/components/organisms/delete-category-dialog";
import { DeleteCategoryGroupDialog } from "@/components/organisms/delete-category-group-dialog";
import type { CategoryGroup } from "@/queries/categories";

interface CategoryListProps {
  groups: CategoryGroup[];
}

export function CategoryList({ groups }: CategoryListProps) {
  const [groupDialogState, setGroupDialogState] = useState<CategoryGroupDialogState>(null);
  const [categoryDialogState, setCategoryDialogState] = useState<CategoryDialogState>(null);
  const [deletingCategory, setDeletingCategory] = useState<{ id: string; name: string } | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<{ id: string; name: string; categoryCount: number } | null>(null);

  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));
  const replacementOptions = groups.flatMap((g) =>
    g.categories.map((c) => ({ id: c.id, name: c.name, groupName: g.name })),
  );

  return (
    <>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => setGroupDialogState({ mode: "add" })}>
          <Plus className="size-3.5" />
          Add Group
        </Button>
      </div>

      <div className="space-y-6">
        {groups.map((group) => (
          <Card key={group.id}>
            <CategoryGroupHeader
              name={group.name}
              icon={group.icon}
              categoryCount={group.categories.length}
              onAddCategory={() => setCategoryDialogState({ mode: "add", groupId: group.id })}
              onEdit={() => setGroupDialogState({ mode: "edit", group: { id: group.id, name: group.name, icon: group.icon } })}
              onDelete={() => setDeletingGroup({ id: group.id, name: group.name, categoryCount: group.categories.length })}
            />
            <Separator />
            <div className="divide-y">
              {group.categories.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">No categories yet.</p>
              ) : (
                group.categories.map((category) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    onEdit={() =>
                      setCategoryDialogState({
                        mode: "edit",
                        category: {
                          id: category.id,
                          name: category.name,
                          icon: category.icon,
                          isIncome: category.isIncome,
                          groupId: group.id,
                        },
                      })
                    }
                    onDelete={() => setDeletingCategory({ id: category.id, name: category.name })}
                  />
                ))
              )}
            </div>
          </Card>
        ))}
      </div>

      <CategoryGroupDialog
        key={`group-dialog-${groupDialogState?.mode === "edit" ? groupDialogState.group.id : (groupDialogState?.mode ?? "closed")}`}
        state={groupDialogState}
        onClose={() => setGroupDialogState(null)}
      />
      <CategoryDialog
        key={`category-dialog-${categoryDialogState?.mode === "edit" ? categoryDialogState.category.id : (categoryDialogState?.mode ?? "closed")}`}
        state={categoryDialogState}
        groups={groupOptions}
        onClose={() => setCategoryDialogState(null)}
      />
      <DeleteCategoryDialog
        key={`delete-category-${deletingCategory?.id ?? "closed"}`}
        category={deletingCategory}
        replacementOptions={replacementOptions}
        onClose={() => setDeletingCategory(null)}
      />
      <DeleteCategoryGroupDialog
        key={`delete-group-${deletingGroup?.id ?? "closed"}`}
        group={deletingGroup}
        onClose={() => setDeletingGroup(null)}
      />
    </>
  );
}
