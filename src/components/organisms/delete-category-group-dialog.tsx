"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteCategoryGroup } from "@/actions/categories";

interface DeleteCategoryGroupDialogProps {
  group: { id: string; name: string; categoryCount: number } | null;
  onClose: () => void;
}

export function DeleteCategoryGroupDialog({ group, onClose }: DeleteCategoryGroupDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(open: boolean) {
    if (!open) {
      setError(null);
      onClose();
    }
  }

  function handleConfirm() {
    if (!group || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCategoryGroup(group.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  const blocked = (group?.categoryCount ?? 0) > 0;

  return (
    <AlertDialog open={group !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{group?.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            {blocked
              ? `Move or delete its ${group?.categoryCount} ${group?.categoryCount === 1 ? "category" : "categories"} first.`
              : "This group has no categories left and can be deleted."}
          </AlertDialogDescription>
        </AlertDialogHeader>

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
            disabled={pending || blocked}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
