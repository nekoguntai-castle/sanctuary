export type CoverageReporter = 'text' | 'html' | 'json-summary' | 'lcov';

const CI_REPORTERS: CoverageReporter[] = ['text', 'json-summary'];
const LOCAL_REPORTERS: CoverageReporter[] = ['text', 'html', 'json-summary', 'lcov'];

export function coverageReporters(isCi: boolean): CoverageReporter[] {
  return [...(isCi ? CI_REPORTERS : LOCAL_REPORTERS)];
}
