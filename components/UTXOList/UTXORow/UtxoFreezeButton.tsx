import { Lock, Unlock } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { UtxoRowModel } from './types';

const FREEZE_BUTTON_CLASSES: Record<'frozen' | 'default', string> = {
  frozen: 'bg-zen-vermilion/10 text-zen-vermilion hover:bg-zen-vermilion/20',
  default: 'text-sanctuary-300 hover:text-zen-matcha hover:bg-zen-matcha/10',
};

interface UtxoFreezeButtonProps {
  model: UtxoRowModel;
  onToggleFreeze: (txid: string, vout: number) => void;
}

export function UtxoFreezeButton({ model, onToggleFreeze }: UtxoFreezeButtonProps) {
  const { txid, vout } = model.utxo;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleFreeze(txid, vout);
  };

  const buttonState = model.isFrozen ? 'frozen' : 'default';
  const title = model.isFrozen ? 'Unfreeze coin for spending' : 'Freeze coin to prevent spending';

  return (
    <button
      onClick={handleClick}
      title={title}
      className={`p-2 rounded-lg transition-colors ${FREEZE_BUTTON_CLASSES[buttonState]}`}
    >
      {model.isFrozen ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
    </button>
  );
}
