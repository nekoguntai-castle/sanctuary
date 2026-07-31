import { Lock, Unlock } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { UtxoRowModel } from './types';

const FREEZE_BUTTON_CLASSES: Record<'frozen' | 'default', string> = {
  frozen: 'bg-zen-vermilion/10 text-zen-vermilion hover:bg-zen-vermilion/20',
  default: 'text-sanctuary-300 hover:text-zen-matcha hover:bg-zen-matcha/10',
};

interface UtxoFreezeButtonProps {
  model: UtxoRowModel;
  isPending: boolean;
  onToggleFreeze: (txid: string, vout: number) => void;
}

export function UtxoFreezeButton({ model, isPending, onToggleFreeze }: UtxoFreezeButtonProps) {
  const { txid, vout } = model.utxo;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleFreeze(txid, vout);
  };

  const buttonState = model.isFrozen ? 'frozen' : 'default';
  const actionTitle = model.isFrozen ? 'Unfreeze coin for spending' : 'Freeze coin to prevent spending';
  const title = isPending
    ? model.isFrozen ? 'Freezing coin' : 'Unfreezing coin'
    : actionTitle;

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      aria-busy={isPending}
      aria-label={title}
      title={title}
      className={`p-2 rounded-lg transition-colors disabled:cursor-wait disabled:opacity-60 ${FREEZE_BUTTON_CLASSES[buttonState]}`}
    >
      {model.isFrozen ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
    </button>
  );
}
