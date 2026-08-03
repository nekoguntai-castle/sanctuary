import { ArrowLeft, ArrowRight, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Toggle } from '../../ui/Toggle';
import type { SelectOption } from './formOptions';

export function AgentFormActions({
  isSaving,
  canSubmit,
  submitLabel,
  secondaryLabel,
  onSecondary,
  onSubmit,
}: {
  isSaving: boolean;
  canSubmit: boolean;
  submitLabel: string;
  secondaryLabel: string;
  onSecondary: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-6 flex justify-end gap-3">
      <Button variant="secondary" onClick={onSecondary}>
        {secondaryLabel === 'Back' && <ArrowLeft className="mr-2 h-4 w-4" />}
        {secondaryLabel}
      </Button>
      <Button onClick={onSubmit} isLoading={isSaving} disabled={!canSubmit}>
        {submitLabel}
        {submitLabel === 'Next' && <ArrowRight className="ml-2 h-4 w-4" />}
      </Button>
    </div>
  );
}

export function AgentNameField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Agent name *</label>
      <Input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Treasury funding agent"
        autoFocus
      />
    </div>
  );
}

export function FullImportPageLink({ disabled = false }: { disabled?: boolean }) {
  const className = `inline-flex items-center gap-2 text-sm font-medium ${
    disabled
      ? 'pointer-events-none text-sanctuary-300 dark:text-sanctuary-700'
      : 'text-primary-700 hover:text-primary-800 dark:text-primary-200 dark:hover:text-primary-100'
  }`;
  const children = (
    <>
      <Upload className="h-4 w-4" />
      Open full import page
    </>
  );

  return (
    <div className="flex items-end">
      {disabled ? (
        <span aria-disabled="true" className={className}>
          {children}
        </span>
      ) : (
        <Link to="/wallets/import" className={className}>
          {children}
        </Link>
      )}
    </div>
  );
}

export function NumberField({
  label,
  ariaLabel,
  value,
  onChange,
  placeholder,
  helper,
  min = 0,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  helper?: string;
  min?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{label}</label>
      <Input
        type="number"
        min={min}
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {helper && <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">{helper}</p>}
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select...',
}: {
  id?: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
      >
        <option value="">{placeholder}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  color,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: 'primary' | 'success' | 'warning';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} color={color} />
    </div>
  );
}
