"use client";

import { useState } from "react";
import { PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SavingsAdvisorPanel } from "@/components/organisms/savings-advisor-panel";
import type { SavingsScopeType } from "@/db/schema";

interface SavingsAdvisorButtonProps {
  scope: { type: SavingsScopeType; id?: string };
  scopeLabel: string;
  variant?: "icon" | "labeled";
  className?: string;
}

/** Trigger + dialog for the Savings Advisor — the same underlying action
 * (getSavingsSuggestionsAction) as the AI chat tool and the MCP tool, run
 * only when a user opens this dialog. See docs/superpowers/specs/
 * 2026-08-21-savings-advisor-design.md for the full design. */
export function SavingsAdvisorButton({ scope, scopeLabel, variant = "icon", className }: SavingsAdvisorButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          variant === "icon" ? (
            <Button variant="ghost" size="icon-sm" className={className} aria-label={`Find savings for ${scopeLabel}`} />
          ) : (
            <Button variant="outline" size="sm" className={className} />
          )
        }
      >
        <PiggyBank />
        {variant === "labeled" && "Find savings"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Savings Advisor</DialogTitle>
          <DialogDescription>{scopeLabel}</DialogDescription>
        </DialogHeader>
        <SavingsAdvisorPanel scope={scope} active={open} />
      </DialogContent>
    </Dialog>
  );
}
