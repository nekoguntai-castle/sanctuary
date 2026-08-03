import { Input } from '../../ui/Input';
import type { NetworkColors, NewServerState } from '../types';

type ServerFieldsProps = {
  newServer: NewServerState;
  colors: NetworkColors;
  onSetNewServer: (server: NewServerState) => void;
};

export function ServerFields({
  newServer,
  colors,
  onSetNewServer,
}: ServerFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Label</label>
        <Input
          type="text"
          value={newServer.label}
          onChange={(event) => onSetNewServer({ ...newServer, label: event.target.value })}
          className="text-sm"
          placeholder="My Server"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Host</label>
        <Input
          type="text"
          value={newServer.host}
          onChange={(event) => onSetNewServer({ ...newServer, host: event.target.value })}
          className="text-sm"
          placeholder="electrum.example.com"
        />
      </div>
      <div className="flex space-x-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-sanctuary-500 mb-1">Port</label>
          <Input
            type="number"
            value={newServer.port}
            onChange={(event) => onSetNewServer({ ...newServer, port: parseServerPort(event.target.value) })}
            className="text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-sanctuary-500 mb-1">SSL</label>
          <button
            onClick={() => onSetNewServer({ ...newServer, useSsl: !newServer.useSsl })}
            className={`px-3 py-2 rounded-lg text-sm ${
              newServer.useSsl ? `${colors.accent}` : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
            }`}
          >
            {newServer.useSsl ? 'SSL' : 'TCP'}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseServerPort(value: string): number {
  return parseInt(value, 10) || 50002;
}
