interface ThresholdFieldProps {
  label: string;
  description: string;
  value: number;
  max: number;
  unit: string;
  onChange: (value: string) => void;
}

export function ThresholdField({
  label,
  description,
  value,
  max,
  unit,
  onChange,
}: ThresholdFieldProps) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
        {label}
      </label>
      <p className="text-sm text-sanctuary-500">{description}</p>
      <div className="flex items-center space-x-3">
        <input
          type="number"
          min="1"
          max={max}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 px-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg surface-muted text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <span className="text-sm text-sanctuary-500">{unit}</span>
      </div>
    </div>
  );
}
