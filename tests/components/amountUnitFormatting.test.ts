import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Bitcoin amounts must render through the unit-aware formatter
 * (`useCurrency().format` / `usePriceFreeFormatter().format` / `<Amount>`), so
 * they follow the user's BTC/sats preference everywhere.
 *
 * A hard-coded `${x} sats` or `${x} BTC` ignores that preference. In 2026-09 a
 * scan found eight of them (the dashboard trend line, notification toasts, the
 * transaction-flow and draft fees, the pending-tx hover card, the AI filter
 * sum, and the Autopilot health card), each showing one fixed unit. This guard
 * fails on any new one.
 *
 * Fee *rates* (`sat/vB`) are a different unit and do not match.
 */

const SRC_ROOT = path.resolve(__dirname, '../../src');

/**
 * Files that may print a fixed unit, each for a stated reason. Adding a file
 * here is a product decision; prefer `format()`.
 */
const ALLOWED_FIXED_UNIT_FILES: Record<string, string> = {
  'contexts/CurrencyPreferencesContext.tsx': 'the unit-aware formatter itself',
  'components/Dashboard/FeeEstimationCard.tsx': 'fee-market estimate shown beside sat/vB rates',
  'components/AgentManagement/formatters.ts': 'agent spend-policy limits are configured in sats',
  'components/AgentWalletDashboard/agentWalletDashboardModel.ts': 'agent spend-policy limits are configured in sats',
  'components/Variables/settingsModel.ts': 'dust threshold setting is configured in sats',
};

// `${expr} sats`, `${expr} BTC`, `{expr} sats`, `{expr} BTC` on one line. The
// unit must not be a prop name (`amountText={...}\n  sats={...}`).
const FIXED_UNIT_AMOUNT = /(\$\{[^}\n]+\}|\{[^}\n]+\})[ \t]*(sats|BTC)\b(?![ \t]*=)/g;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function fixedUnitAmounts(source: string): string[] {
  return [...source.matchAll(FIXED_UNIT_AMOUNT)].map((match) => match[0]);
}

describe('bitcoin amount unit formatting', () => {
  it('flags template and JSX amounts with a hard-coded unit, but not fee rates', () => {
    const source = [
      'const a = `${fee.toLocaleString()} sats`;',
      'const b = `${formatBTC(satsToBTC(x))} BTC`;',
      'const c = <span>{amount.toLocaleString()} sats</span>;',
      'const d = `${rate} sat/vB`;',
      'const e = <span>{format(amount)}</span>;',
      '<FlowAmountText amountText={format(input.amount)}',
      '  sats={input.amount} />',
      '<Amount value={x} sats={y} />',
    ].join('\n');

    expect(fixedUnitAmounts(source)).toEqual([
      '${fee.toLocaleString()} sats',
      '${formatBTC(satsToBTC(x))} BTC',
      '{amount.toLocaleString()} sats',
    ]);
  });

  it('keeps every allowlisted file present, so the list cannot rot', () => {
    const missing = Object.keys(ALLOWED_FIXED_UNIT_FILES).filter(
      (file) => !listSourceFiles(SRC_ROOT).includes(path.join(SRC_ROOT, file)),
    );
    expect(missing).toEqual([]);
  });

  it('renders every other amount in src through the unit-aware formatter', () => {
    const offenders = listSourceFiles(SRC_ROOT)
      .filter((file) => !(path.relative(SRC_ROOT, file) in ALLOWED_FIXED_UNIT_FILES))
      .flatMap((file) =>
        fixedUnitAmounts(readFileSync(file, 'utf8')).map((hit) => `${path.relative(SRC_ROOT, file)}: ${hit}`),
      );
    expect(offenders).toEqual([]);
  });
});
