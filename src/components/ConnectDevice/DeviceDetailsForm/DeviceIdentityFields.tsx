import { Input } from '../../ui/Input';
import type { ConnectionMethod, DeviceFormData } from '../types';

interface DeviceIdentityFieldsProps {
  selectedModelName: string;
  label: string;
  fingerprint: string;
  method: ConnectionMethod | null;
  scanned: boolean;
  onFormDataChange: (updates: Partial<DeviceFormData>) => void;
}

export function DeviceIdentityFields({
  selectedModelName,
  label,
  fingerprint,
  method,
  scanned,
  onFormDataChange,
}: DeviceIdentityFieldsProps) {
  const isReadOnlyImport = method !== 'manual' && scanned;

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Device Label</label>
        <Input
          type="text"
          value={label}
          onChange={(e) => onFormDataChange({ label: e.target.value })}
          placeholder={`My ${selectedModelName}`}
          className="text-sm focus:ring-sanctuary-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Master Fingerprint</label>
        <Input
          type="text"
          value={fingerprint}
          onChange={(e) => onFormDataChange({ fingerprint: e.target.value })}
          placeholder="00000000"
          readOnly={isReadOnlyImport}
          className={`text-sm font-mono focus:ring-sanctuary-500 ${isReadOnlyImport ? 'opacity-70' : ''}`}
        />
      </div>
    </>
  );
}
