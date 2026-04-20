import { AlertTriangle } from 'lucide-react';
import type { UtxoPrivacyInfo } from '../../../src/api/transactions';
import { Amount } from '../../Amount';
import { PrivacyBadge } from '../../PrivacyBadge';
import type { UtxoRowModel } from './types';

interface UtxoAmountSummaryProps {
  model: UtxoRowModel;
  privacyInfo?: UtxoPrivacyInfo;
  showPrivacy: boolean;
  onShowPrivacyDetail: (id: string) => void;
  format: (sats: number) => string;
}

export function UtxoAmountSummary({
  model,
  privacyInfo,
  showPrivacy,
  onShowPrivacyDetail,
  format,
}: UtxoAmountSummaryProps) {
  return (
    <div className={model.amountClassName}>
      <Amount sats={model.utxo.amount} size="lg" />
      <DustBadge model={model} format={format} />
      <PrivacyBadgeButton
        model={model}
        privacyInfo={privacyInfo}
        showPrivacy={showPrivacy}
        onShowPrivacyDetail={onShowPrivacyDetail}
      />
    </div>
  );
}

interface DustBadgeProps {
  model: UtxoRowModel;
  format: (sats: number) => string;
}

function DustBadge({ model, format }: DustBadgeProps) {
  if (!model.isDust) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      title={`Costs ${format(model.spendCost)} to spend at current fees`}
    >
      <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
      DUST
    </span>
  );
}

interface PrivacyBadgeButtonProps {
  model: UtxoRowModel;
  privacyInfo?: UtxoPrivacyInfo;
  showPrivacy: boolean;
  onShowPrivacyDetail: (id: string) => void;
}

function PrivacyBadgeButton({
  model,
  privacyInfo,
  showPrivacy,
  onShowPrivacyDetail,
}: PrivacyBadgeButtonProps) {
  if (!showPrivacy) {
    return null;
  }

  if (!privacyInfo) {
    return null;
  }

  return (
    <span onClick={(event) => event.stopPropagation()}>
      <PrivacyBadge
        score={privacyInfo.score.score}
        grade={privacyInfo.score.grade}
        size="sm"
        onClick={() => onShowPrivacyDetail(model.id)}
      />
    </span>
  );
}
