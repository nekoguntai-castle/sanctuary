import { Check, Copy, ExternalLink, QrCode } from 'lucide-react';
import type { Address } from '../../../../types';
import { truncateAddress } from '../../../../utils/formatters';
import { getAddressExplorerUrl } from '../../../../utils/explorer';
import type { CopyAddress, IsAddressCopied } from './types';

type AddressActionsCellProps = {
  address: Address;
  network: string;
  explorerUrl: string;
  copy: CopyAddress;
  isCopied: IsAddressCopied;
  onShowQrModal: (address: string) => void;
};

export function AddressActionsCell({
  address,
  network,
  explorerUrl,
  copy,
  isCopied,
  onShowQrModal,
}: AddressActionsCellProps) {
  const copied = isCopied(address.address);

  return (
    <td className="px-6 py-4 whitespace-nowrap">
      <div className="flex items-center space-x-2">
        <span
          className="text-sm font-mono text-sanctuary-700 dark:text-sanctuary-300 cursor-default"
          title={address.address}
        >
          {truncateAddress(address.address)}
        </span>
        <button
          className={`transition-colors ${copied ? 'text-success-500' : 'text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300'}`}
          onClick={() => copy(address.address)}
          title={copied ? 'Copied!' : 'Copy address'}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
        <button
          className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
          onClick={() => onShowQrModal(address.address)}
          title="Show QR code"
        >
          <QrCode className="w-3 h-3" />
        </button>
        <a
          href={getAddressExplorerUrl(address.address, network || 'mainnet', explorerUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sanctuary-400 hover:text-primary-500 dark:hover:text-primary-400"
          title="View on block explorer"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </td>
  );
}
