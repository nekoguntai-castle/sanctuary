import type { DetailCard as DetailCardModel } from './detailsModel';

export function DetailCard({ label, value, muted }: DetailCardModel) {
  return (
    <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
      <p className="text-xs text-sanctuary-500 mb-1">{label}</p>
      <p className={`text-sm font-medium ${muted ? 'text-sanctuary-400' : 'text-sanctuary-900 dark:text-sanctuary-100'}`}>
        {value}
      </p>
    </div>
  );
}
