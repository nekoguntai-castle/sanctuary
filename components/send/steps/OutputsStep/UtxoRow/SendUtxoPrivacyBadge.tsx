import { PrivacyBadge } from '../../../../PrivacyBadge';
import type { UtxoPrivacyInfo } from '../../../../../src/api/transactions';

interface SendUtxoPrivacyBadgeProps {
  privacyInfo?: UtxoPrivacyInfo;
}

export function SendUtxoPrivacyBadge({ privacyInfo }: SendUtxoPrivacyBadgeProps) {
  if (!privacyInfo?.score) return null;

  return (
    <PrivacyBadge
      grade={privacyInfo.score.grade}
      score={privacyInfo.score.score}
      size="sm"
    />
  );
}
