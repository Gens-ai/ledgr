"use client";

import { CategoryIcon, CATEGORY_ICON_NAMES } from "@/components/atoms/category-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CategoryIconPickerProps {
  value: string | null;
  onChange: (icon: string) => void;
  /** Accessible name, e.g. "Change icon for Groceries". */
  label: string;
  disabled?: boolean;
}

/** Compact icon-only picker for a category or group row. */
export function CategoryIconPicker({ value, onChange, label, disabled }: CategoryIconPickerProps) {
  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger size="sm" aria-label={label} className="px-1.5 text-muted-foreground">
        <SelectValue>
          <CategoryIcon name={value} size={16} />
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
  );
}
