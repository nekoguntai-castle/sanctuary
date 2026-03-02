#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve(
  process.cwd(),
  process.env.MUTATION_REPORT_PATH ?? 'reports/mutation/critical-mutation-report.json'
);
const baselinePath = path.resolve(
  process.cwd(),
  process.env.MUTATION_BASELINE_PATH ?? '../.github/mutation-baseline.json'
);

const PROFILE_KEY = process.env.MUTATION_BASELINE_PROFILE ?? 'serverCritical';

const WEIGHTED_PATH_RULES = [
  { prefix: 'src/services/bitcoin/addressDerivation.ts', weight: 5 },
  { prefix: 'src/services/bitcoin/addressDerivation/', weight: 5 },
  { prefix: 'src/services/bitcoin/psbtValidation.ts', weight: 4 },
  { prefix: 'src/services/bitcoin/psbtInfo.ts', weight: 4 },
  { prefix: 'src/middleware/auth.ts', weight: 3 },
  { prefix: 'src/services/accessControl.ts', weight: 3 },
];

const KILLED_STATUSES = new Set(['Killed', 'Timeout']);
const COUNTED_NON_KILLED = new Set(['Survived', 'NoCoverage', 'RuntimeError', 'CompileError']);

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveWeight(filePath) {
  const rule = WEIGHTED_PATH_RULES.find((entry) => filePath.startsWith(entry.prefix));
  return rule?.weight ?? 1;
}

function pct(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

const report = readJson(reportPath);
const baselineRoot = readJson(baselinePath);
const baseline = baselineRoot?.[PROFILE_KEY] ?? {};

const weightedScoreMin = Number(baseline.weightedScoreMin ?? 0);
const rawScoreMin = Number(baseline.rawScoreMin ?? 0);

let rawKilled = 0;
let rawCounted = 0;
let weightedKilled = 0;
let weightedCounted = 0;
const survivors = [];

for (const [filePath, fileData] of Object.entries(report.files ?? {})) {
  const mutants = fileData?.mutants ?? [];
  const weight = resolveWeight(filePath);

  for (const mutant of mutants) {
    const status = mutant?.status;
    if (KILLED_STATUSES.has(status)) {
      rawKilled += 1;
      rawCounted += 1;
      weightedKilled += weight;
      weightedCounted += weight;
      continue;
    }

    if (COUNTED_NON_KILLED.has(status)) {
      rawCounted += 1;
      weightedCounted += weight;
    }

    if (status === 'Survived') {
      survivors.push({
        filePath,
        line: mutant?.location?.start?.line ?? 0,
        mutatorName: mutant?.mutatorName ?? 'unknown',
        replacement: mutant?.replacement ?? '',
        weight,
      });
    }
  }
}

const rawScore = round2(pct(rawKilled, rawCounted));
const weightedScore = round2(pct(weightedKilled, weightedCounted));

const sortedSurvivors = survivors
  .slice()
  .sort((a, b) => b.weight - a.weight || a.filePath.localeCompare(b.filePath) || a.line - b.line);

const topSurvivors = sortedSurvivors.slice(0, 25);

const summaryLines = [
  '## Critical Mutation Gate',
  '',
  `- Report: \`${path.relative(process.cwd(), reportPath)}\``,
  `- Baseline profile: \`${PROFILE_KEY}\``,
  `- Raw mutation score: \`${rawScore}%\` (min \`${rawScoreMin}%\`)`,
  `- Weighted mutation score: \`${weightedScore}%\` (min \`${weightedScoreMin}%\`)`,
  `- Surviving mutants: \`${survivors.length}\``,
];

if (topSurvivors.length > 0) {
  summaryLines.push('', '### Top Surviving Mutants', '', '| Weight | File | Line | Mutator | Replacement |', '|---:|---|---:|---|---|');
  for (const item of topSurvivors) {
    const replacement = item.replacement.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    summaryLines.push(
      `| ${item.weight} | \`${item.filePath}\` | ${item.line} | \`${item.mutatorName}\` | \`${replacement}\` |`
    );
  }
}

for (const line of summaryLines) {
  console.log(line);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summaryLines.join('\n')}\n`);
}

if (rawCounted === 0 || weightedCounted === 0) {
  console.error('Mutation gate failed: no counted mutants in report.');
  process.exit(1);
}

if (rawScore < rawScoreMin) {
  console.error(`Mutation gate failed: raw score ${rawScore}% < ${rawScoreMin}%`);
  process.exit(1);
}

if (weightedScore < weightedScoreMin) {
  console.error(`Mutation gate failed: weighted score ${weightedScore}% < ${weightedScoreMin}%`);
  process.exit(1);
}

