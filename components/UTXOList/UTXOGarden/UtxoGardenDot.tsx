import type { UtxoGardenDotModel } from './types';

interface UtxoGardenDotProps {
  model: UtxoGardenDotModel;
  onToggleSelect?: (id: string) => void;
}

export function UtxoGardenDot({ model, onToggleSelect }: UtxoGardenDotProps) {
  const handleClick =
    model.isDisabled || !onToggleSelect ? undefined : () => onToggleSelect(model.id);

  return (
    <div
      onClick={handleClick}
      style={{
        width: model.size,
        height: model.size,
        ...model.style,
      }}
      className={`
        relative rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-125 hover:z-10
        ${model.isDisabled ? 'cursor-not-allowed' : ''}
        ${model.isSelected ? 'ring-2 ring-offset-1 ring-sanctuary-400 dark:ring-offset-sanctuary-900' : ''}
        ${model.colorClass} text-white shadow-md
      `}
      title={model.title}
    >
      <span className="text-[9px] font-bold opacity-0 hover:opacity-100 transition-opacity absolute bg-black/80 text-white px-1.5 py-0.5 rounded whitespace-nowrap -top-6 z-20 pointer-events-none">
        {model.formattedAmount}
      </span>
    </div>
  );
}
