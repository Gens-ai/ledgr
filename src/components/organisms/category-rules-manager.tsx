"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, Plus, X } from "lucide-react";
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
import {
  createCategoryRule,
  updateCategoryRule,
  deleteCategoryRule,
} from "@/actions/category-rules";
import type { CategoryRuleRow } from "@/queries/category-rules";
import type { CategoryGroup } from "@/queries/categories";

interface CategoryRulesManagerProps {
  rules: CategoryRuleRow[];
  categoryGroups: CategoryGroup[];
  /** The household's live accounts, for limiting a rule to one of them. */
  accounts: { id: string; name: string }[];
}

/** Base UI's Select needs a value for every item; this one means "no account". */
const ANY_ACCOUNT = "__any__";

type MatchField = "name" | "merchant";

const FIELD_LABEL: Record<MatchField, string> = {
  name: "Transaction name",
  merchant: "Merchant name",
};

interface DraftState {
  id: string | null;
  categoryId: string;
  matchField: MatchField;
  matchPattern: string;
  priority: string;
  /** ANY_ACCOUNT, or the id of the one account the rule is limited to. */
  accountId: string;
}

function emptyDraft(categoryId: string): DraftState {
  return { id: null, categoryId, matchField: "name", matchPattern: "", priority: "0", accountId: ANY_ACCOUNT };
}

export function CategoryRulesManager({ rules, categoryGroups, accounts }: CategoryRulesManagerProps) {
  const flatCategories = categoryGroups.flatMap((g) => g.categories);
  const firstCategoryId = flatCategories[0]?.id ?? "";

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setError(null);
    setDraft(emptyDraft(firstCategoryId));
  }

  function openEdit(rule: CategoryRuleRow) {
    setError(null);
    setDraft({
      id: rule.id,
      categoryId: rule.categoryId,
      matchField: rule.matchField,
      matchPattern: rule.matchPattern,
      priority: String(rule.priority),
      accountId: rule.accountId ?? ANY_ACCOUNT,
    });
  }

  function save() {
    if (!draft) return;
    setError(null);
    const payload = {
      categoryId: draft.categoryId,
      matchField: draft.matchField,
      matchPattern: draft.matchPattern,
      priority: Number(draft.priority) || 0,
      accountId: draft.accountId === ANY_ACCOUNT ? null : draft.accountId,
    };

    startTransition(async () => {
      const result = draft.id
        ? await updateCategoryRule({ ...payload, id: draft.id })
        : await createCategoryRule(payload);

      if ("error" in result) {
        setError(result.error);
        return;
      }
      setDraft(null);
    });
  }

  function remove(ruleId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteCategoryRule(ruleId);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      {/* Rules only run during a sync, and only on transactions that have no
          category yet. Saying so up front stops the page reading as broken
          when a new rule does not visibly change anything. */}
      <div className="rounded-lg border border-l-2 border-l-amber-500 bg-card p-3 text-sm">
        <p className="font-medium">Rules apply on your next sync</p>
        <p className="text-muted-foreground">
          A new rule categorizes matching transactions the next time an account syncs. It does not
          re-file transactions that are already in your review queue, and it never changes a
          category you set yourself.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Your rules</h2>
            <p className="text-xs text-muted-foreground">
              {rules.length === 0
                ? "Checked before every other categorization step"
                : `${rules.length} rule${rules.length === 1 ? "" : "s"}, account rules first, then highest priority`}
            </p>
          </div>
          {!draft && (
            <Button size="sm" onClick={openCreate} disabled={flatCategories.length === 0}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              New rule
            </Button>
          )}
        </div>

        {draft && (
          <div className="space-y-3 border-b bg-muted/30 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rule-field">Match on</Label>
                <Select
                  value={draft.matchField}
                  onValueChange={(v) => {
                    if (v !== null) setDraft({ ...draft, matchField: v as MatchField });
                  }}
                >
                  <SelectTrigger id="rule-field">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FIELD_LABEL) as MatchField[]).map((f) => (
                      <SelectItem key={f} value={f}>
                        {FIELD_LABEL[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rule-category">Category</Label>
                <Select
                  value={draft.categoryId}
                  onValueChange={(v) => {
                    if (v !== null) setDraft({ ...draft, categoryId: v });
                  }}
                >
                  <SelectTrigger id="rule-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {flatCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-account">Account</Label>
              <Select
                value={draft.accountId}
                onValueChange={(v) => {
                  if (v !== null) setDraft({ ...draft, accountId: v });
                }}
              >
                <SelectTrigger id="rule-account" className="w-full sm:w-1/2">
                  <SelectValue>
                    {draft.accountId === ANY_ACCOUNT
                      ? "Any account"
                      : (accounts.find((a) => a.id === draft.accountId)?.name ?? "Removed account")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_ACCOUNT}>Any account</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A rule limited to one account runs before rules for any account. With an account
                chosen, leave the pattern empty to catch everything on that account.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
              <div className="space-y-1.5">
                <Label htmlFor="rule-pattern">Pattern contains</Label>
                <Input
                  id="rule-pattern"
                  value={draft.matchPattern}
                  placeholder={draft.accountId === ANY_ACCOUNT ? "e.g. twitterapi" : "Empty = everything on this account"}
                  autoComplete="off"
                  onChange={(e) => setDraft({ ...draft, matchPattern: e.target.value })}
                />
                {/* The engine does target.includes(pattern), so "contains" is
                    literally what happens. Saying "matches" would invite regex. */}
                <p className="text-xs text-muted-foreground">
                  Plain text, not a pattern language. Capitalization is ignored.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rule-priority">Priority</Label>
                <Input
                  id="rule-priority"
                  type="number"
                  min={0}
                  max={999}
                  value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Higher wins</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={save}
                disabled={pending || (draft.accountId === ANY_ACCOUNT && !draft.matchPattern.trim())}
              >
                {draft.id ? "Save rule" : "Add rule"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={pending}>
                <X className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {rules.length === 0 && !draft ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <p className="text-sm font-medium">No rules yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Rules catch transactions before Ledgr guesses. They run ahead of merchant defaults
              and your bank&apos;s own category, so a rule always wins.
            </p>
            <Button size="sm" className="mt-1" onClick={openCreate} disabled={flatCategories.length === 0}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add your first rule
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {rule.priority}
                </span>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {rule.matchField}
                  </span>
                  {rule.matchPattern ? (
                    <span className="font-mono text-xs">&ldquo;{rule.matchPattern}&rdquo;</span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">everything</span>
                  )}
                  {rule.accountId && (
                    <span className="text-xs text-muted-foreground">
                      on <span className="font-medium text-foreground">{rule.accountName ?? "a removed account"}</span>
                    </span>
                  )}
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium">{rule.categoryName}</span>
                </div>
                <div className="ml-auto flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Edit rule for ${rule.matchPattern || `everything on ${rule.accountName ?? "account"}`}`}
                    onClick={() => openEdit(rule)}
                    disabled={pending}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:text-destructive"
                    aria-label={`Delete rule for ${rule.matchPattern || `everything on ${rule.accountName ?? "account"}`}`}
                    onClick={() => remove(rule.id)}
                    disabled={pending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
