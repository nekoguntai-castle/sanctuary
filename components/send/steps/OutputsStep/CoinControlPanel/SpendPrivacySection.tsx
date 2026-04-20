import SpendPrivacyCard from '../../../../SpendPrivacyCard';
import type { SpendPrivacyAnalysis } from '../../../../../src/api/transactions';

interface SpendPrivacySectionProps {
  privacyAnalysis: SpendPrivacyAnalysis | null;
  selectedCount: number;
}

export function SpendPrivacySection({
  privacyAnalysis,
  selectedCount,
}: SpendPrivacySectionProps) {
  if (!privacyAnalysis || selectedCount < 1) return null;

  return <SpendPrivacyCard analysis={privacyAnalysis} className="mt-3" />;
}
