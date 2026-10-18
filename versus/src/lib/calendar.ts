/**
 * Trading-day calendar for the two benchmark markets.
 * Static holiday lists (full-day closures only). Early-close days need no handling: the snapshot
 * runs after the latest possible close. Extend yearly; `isKnownYear` lets callers refuse to guess.
 */
export type Market = "NYSE" | "TSX";

const HOLIDAYS: Record<Market, ReadonlySet<string>> = {
  // NYSE published holiday schedule.
  NYSE: new Set([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  ]),
  // TSX published holiday schedule.
  TSX: new Set([
    "2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-08-03", "2026-09-07", "2026-10-12", "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-02-15", "2027-03-26", "2027-05-24", "2027-07-01", "2027-08-02", "2027-09-06", "2027-10-11", "2027-12-27", "2027-12-28",
  ]),
};

const KNOWN_YEARS = new Set([2026, 2027]);

export const isKnownYear = (date: string): boolean => KNOWN_YEARS.has(Number(date.slice(0, 4)));

const dayOfWeek = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
export const isWeekday = (date: string): boolean => {
  const d = dayOfWeek(date);
  return d >= 1 && d <= 5;
};

export const isMarketOpen = (market: Market, date: string): boolean => isWeekday(date) && !HOLIDAYS[market].has(date);
export const isAnyMarketOpen = (date: string): boolean => isMarketOpen("NYSE", date) || isMarketOpen("TSX", date);

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Calendar date in New York (both markets close at 16:00 ET). */
export function newYorkDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** UTC offset of America/New_York on `date`, in hours (4 in EDT, 5 in EST). */
function nyOffsetHours(date: string): number {
  const probe = new Date(`${date}T16:00:00Z`);
  const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(probe);
  return 16 - Number(local);
}

/** UTC instant of `hh:mm` America/New_York on `date`, DST-correct. */
function nyInstant(date: string, hh: number, mm: number): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + ((hh + nyOffsetHours(date)) * 60 + mm) * 60_000);
}

/** Both markets close at 16:00 ET and open at 09:30 ET. */
export const closeInstant = (date: string): Date => nyInstant(date, 16, 0);
export const openInstant = (date: string): Date => nyInstant(date, 9, 30);

export function nextTradingDay(date: string): string {
  let d = addDays(date, 1);
  for (let i = 0; i < 10 && !isAnyMarketOpen(d); i++) d = addDays(d, 1);
  return d;
}

/**
 * True when prices fetched at `at` are the close of `closeDateFor(at)`: after that close and
 * before the next session opens. A sign-in at noon on a trading day is not a close.
 */
export function isCloseWindow(at: Date): boolean {
  const d = closeDateFor(at);
  return at.getTime() >= closeInstant(d).getTime() && at.getTime() < openInstant(nextTradingDay(d)).getTime();
}

/**
 * The trading date whose close a snapshot taken at `at` represents:
 * today if at least one market is open and we are past the close; otherwise the most recent
 * earlier trading date. Before today's close, today is not yet a close, so we look back.
 */
export function closeDateFor(at: Date): string {
  let date = newYorkDate(at);
  if (!(isAnyMarketOpen(date) && at.getTime() >= closeInstant(date).getTime())) date = addDays(date, -1);
  for (let i = 0; i < 10 && !isAnyMarketOpen(date); i++) date = addDays(date, -1);
  return date;
}

/** Number of trading days in (from, to], counting a day if either market was open. */
export function tradingDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isAnyMarketOpen(d)) n++;
  return n;
}
