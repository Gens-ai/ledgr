"use client";

import { useState } from "react";
import { useActionTransition } from "@/hooks/use-action-transition";
import { updateDealsSettingsAction } from "@/actions/savings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface SavingsSettingsFormProps {
  initialEnabled: boolean;
  initialLocation: string | null;
  hasWebSearchProvider: boolean;
}

export function SavingsSettingsForm({ initialEnabled, initialLocation, hasWebSearchProvider }: SavingsSettingsFormProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [location, setLocation] = useState(initialLocation ?? "");
  const { isPending, execute } = useActionTransition();

  function save(next: { dealsWebSearchEnabled: boolean; dealsLocation: string | null }) {
    execute(() => updateDealsSettingsAction(next));
  }

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    save({ dealsWebSearchEnabled: checked, dealsLocation: location || null });
  }

  function handleLocationBlur() {
    save({ dealsWebSearchEnabled: enabled, dealsLocation: location || null });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Savings Advisor</CardTitle>
        <CardDescription>
          Control whether the Savings Advisor&apos;s deals search can use your AI provider&apos;s web search. Off by
          default — the advisor&apos;s core suggestions never need this and never leave your server beyond the AI
          calls the app already makes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="deals-toggle" className="cursor-pointer">
            Let deals search use my AI provider&apos;s web search
          </Label>
          <Switch
            id="deals-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isPending || !hasWebSearchProvider}
          />
        </div>
        {!hasWebSearchProvider && (
          <p className="text-xs text-muted-foreground">
            Your configured AI provider doesn&apos;t support hosted web search (only Anthropic, OpenAI, and Google
            do) — deals search isn&apos;t available.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="deals-location">Shopping area (optional)</Label>
          <Input
            id="deals-location"
            placeholder="e.g. Seattle, WA or 98103"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onBlur={handleLocationBlur}
            disabled={isPending || !enabled}
            className="max-w-xs"
          />
          <p className="text-xs text-muted-foreground">
            Only used to give deals search geographic context — included in searches your AI provider runs when
            you ask for deals.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
