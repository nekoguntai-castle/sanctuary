import { Input } from '../../ui/Input';
import type { ConnectionMethod, DeviceFormData } from '../types';

interface SingleAccountFieldsProps {
  xpub: string;
  derivationPath: string;
  method: ConnectionMethod | null;
  scanned: boolean;
  onFormDataChange: (updates: Partial<DeviceFormData>) => void;
}

export function SingleAccountFields({
  xpub,
  derivationPath,
  method,
  scanned,
  onFormDataChange,
}: SingleAccountFieldsProps) {
  const isReadOnlyImport = Boolean(method && scanned);

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Derivation Path</label>
        <Input
          type="text"
          value={derivationPath}
          onChange={(e) => onFormDataChange({ derivationPath: e.target.value })}
          readOnly={isReadOnlyImport}
          className={`text-sm font-mono focus:ring-sanctuary-500 ${isReadOnlyImport ? 'opacity-70' : ''}`}
        />
        <p className="text-[10px] text-sanctuary-400 mt-1">Imported account derivation path</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Extended Public Key</label>
        <textarea
          value={xpub}
          onChange={(e) => onFormDataChange({ xpub: e.target.value })}
          placeholder="xpub... / ypub... / zpub..."
          readOnly={isReadOnlyImport}
          rows={3}
          className={`w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500 resize-none ${isReadOnlyImport ? 'opacity-70' : ''}`}
        />
      </div>
    </>
  );
}
