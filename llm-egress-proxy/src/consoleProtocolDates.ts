import type {
  DateRangeIntent,
  RelativeDateRangeValue,
} from "./consoleProtocolIntents";
import type { ConsolePlanInput } from "./consoleProtocolTypes";

const monthNumbers: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const MONTH_YEAR_RANGE_PATTERN =
  /\b(?:between|from)\s+([a-z]+)\s+(\d{4})\s+(?:and|to|through|-)\s+([a-z]+)\s+(\d{4})\b/i;

interface ParsedMonthYear {
  month: number;
  year: number;
}

function parseMonthYear(
  monthText?: string,
  yearText?: string,
): ParsedMonthYear | null {
  const month = monthNumbers[monthText?.toLowerCase() ?? ""];
  const year = Number.parseInt(yearText ?? "", 10);
  if (month === undefined || !Number.isSafeInteger(year)) return null;
  return { month, year };
}

function monthStartIsoDate(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString();
}

function monthEndIsoDate(year: number, month: number): string {
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString();
}

function yearStartIsoDate(year: number): string {
  return monthStartIsoDate(year, 0);
}

function yearEndIsoDate(year: number): string {
  return monthEndIsoDate(year, 11);
}

function toIsoDate(year: number, month: number, endOfMonth = false): string {
  if (endOfMonth) return monthEndIsoDate(year, month);
  return monthStartIsoDate(year, month);
}

function parseMonthYearRange(prompt: string): {
  dateFrom: string;
  dateTo: string;
} | null {
  const range = prompt.match(MONTH_YEAR_RANGE_PATTERN);
  if (!range) return null;

  const from = parseMonthYear(range[1], range[2]);
  const to = parseMonthYear(range[3], range[4]);
  if (!from || !to) return null;

  return {
    dateFrom: toIsoDate(from.year, from.month),
    dateTo: toIsoDate(to.year, to.month, true),
  };
}

function parseSingleMonthYearRange(prompt: string): {
  dateFrom: string;
  dateTo: string;
} | null {
  const monthYear = prompt.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(?:of\s+)?(\d{4})\b/i,
  );
  if (!monthYear) return null;

  const monthText = monthYear[1]?.toLowerCase() ?? "";
  const month = monthNumbers[monthText];
  const year = Number.parseInt(monthYear[2] ?? "", 10);

  if (month === undefined || !Number.isSafeInteger(year)) {
    return null;
  }

  return {
    dateFrom: toIsoDate(year, month),
    dateTo: toIsoDate(year, month, true),
  };
}

function parseIsoDateRange(prompt: string): {
  dateFrom: string;
  dateTo: string;
} | null {
  const range = prompt.match(
    /\b(\d{4}-\d{2}-\d{2})\b\s*(?:and|to|through|-)\s*\b(\d{4}-\d{2}-\d{2})\b/i,
  );
  if (!range) return null;

  return {
    dateFrom: new Date(`${range[1]}T00:00:00.000Z`).toISOString(),
    dateTo: new Date(`${range[2]}T23:59:59.999Z`).toISOString(),
  };
}

export function referenceYear(input: ConsolePlanInput): number {
  const parsed = input.currentDate
    ? new Date(`${input.currentDate}T00:00:00.000Z`)
    : new Date();
  return Number.isNaN(parsed.getTime())
    ? new Date().getUTCFullYear()
    : parsed.getUTCFullYear();
}

export function resolveRelativeDateRange(
  value: RelativeDateRangeValue,
  currentYear: number,
): {
  dateFrom: string;
  dateTo: string;
} {
  const targetYear = value === "previous_year" ? currentYear - 1 : currentYear;
  return {
    dateFrom: yearStartIsoDate(targetYear),
    dateTo: yearEndIsoDate(targetYear),
  };
}

export function resolveDateRangeIntent(
  dateRange: DateRangeIntent | undefined,
  currentYear: number,
): Record<string, string> {
  if (!dateRange) return {};
  if (dateRange.kind === "relative")
    return resolveRelativeDateRange(dateRange.value, currentYear);
  return {
    ...(dateRange.dateFrom ? { dateFrom: dateRange.dateFrom } : {}),
    ...(dateRange.dateTo ? { dateTo: dateRange.dateTo } : {}),
  };
}

function parsePromptDateRange(prompt: string) {
  return (
    parseRelativeYearPromptRange(prompt) ??
    parseIsoDateRange(prompt) ??
    parseMonthYearRange(prompt) ??
    parseSingleMonthYearRange(prompt)
  );
}

function parseRelativeYearPromptRange(
  prompt: string,
): { value: RelativeDateRangeValue } | null {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("this year") || normalized.includes("current year")) {
    return { value: "current_year" };
  }
  if (
    normalized.includes("last year") ||
    normalized.includes("previous year")
  ) {
    return { value: "previous_year" };
  }
  return null;
}

export function fallbackPromptDateRange(input: ConsolePlanInput) {
  const parsed = parsePromptDateRange(input.prompt);
  if (!parsed) return {};
  if ("value" in parsed) {
    return resolveRelativeDateRange(parsed.value, referenceYear(input));
  }
  return parsed;
}
