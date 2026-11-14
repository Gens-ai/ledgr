"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { GroupMode } from "@/lib/group-filter";

interface GroupFilterFieldsProps {
  groups: { id: string; name: string }[];
  selectedIds: string[];
  mode: GroupMode;
  onToggle: (id: string) => void;
  onModeChange: (mode: GroupMode) => void;
}

/**
 * The body of the category-group multi-select, shared by Reports and
 * Transactions (desktop popovers and mobile sheets alike): an include/exclude
 * switch above a checkbox list of groups. Uncategorized transactions belong to
 * no group, so they appear only in "All except" mode — the hint says so.
 */
export function GroupFilterFields({ groups, selectedIds, mode, onToggle, onModeChange }: GroupFilterFieldsProps) {
  return (
    <div>
      <div className="space-y-1 px-2 pt-2">
        <ToggleGroup
          value={[mode]}
          onValueChange={(values) => {
            // Base UI hands back [] when the active item is clicked again.
            const next = values[0];
            if (next === "include" || next === "exclude") onModeChange(next);
          }}
          size="sm"
          aria-label="Group filter mode"
          className="w-full"
        >
          <ToggleGroupItem value="include" className="flex-1 px-2 text-xs">
            Only these
          </ToggleGroupItem>
          <ToggleGroupItem value="exclude" className="flex-1 px-2 text-xs">
            All except these
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="px-0.5 text-[11px] text-muted-foreground">
          {mode === "exclude"
            ? "Uncategorized transactions are included."
            : "Uncategorized transactions are left out."}
        </p>
      </div>
      <Command>
        <CommandInput name="group-search" placeholder="Search groups..." className="h-8" />
        <CommandList>
          <CommandEmpty>No groups found.</CommandEmpty>
          <CommandGroup>
            {groups.map((g) => (
              <CommandItem key={g.id} value={g.name} onSelect={() => onToggle(g.id)}>
                <Checkbox checked={selectedIds.includes(g.id)} className="mr-2" />
                {g.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
