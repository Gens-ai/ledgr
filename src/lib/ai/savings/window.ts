/** Occurrences per 30-day month for each recurring frequency, used to turn a
 * per-occurrence recurring amount into a comparable monthly figure. */
const OCCURRENCES_PER_MONTH: Record<string, number> = {
  weekly: 30 / 7,
  biweekly: 30 / 14,
  semimonthly: 2,
  monthly: 1,
  yearly: 1 / 12,
};

export function monthlyEquivalentCents(totalCents: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return Math.round((totalCents / windowDays) * 30);
}

export function recurringMonthlyCents(frequency: string | null, averageAmountCents: number): number {
  const occurrences = frequency ? (OCCURRENCES_PER_MONTH[frequency] ?? 1) : 1;
  return Math.round(averageAmountCents * occurrences);
}
