import { ExternalLink } from 'lucide-react';
import { getAddressExplorerUrl } from '../../../utils/explorer';

interface UtxoAddressLinkProps {
  address: string;
  network: string;
  explorerUrl: string | null;
}

export function UtxoAddressLink({ address, network, explorerUrl }: UtxoAddressLinkProps) {
  // No explorer is configured for the active network, or it has not resolved
  // yet. Render the address as plain text rather than linking it — a link built
  // from a default-network base sends a testnet address to a mainnet explorer.
  if (!explorerUrl) {
    return (
      <span
        className="text-xs text-sanctuary-500 font-mono break-all max-w-md inline-flex items-center"
        title={`No block explorer configured for ${network}`}
      >
        {address}
      </span>
    );
  }

  return (
    <a
      href={getAddressExplorerUrl(address, network, explorerUrl)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="text-xs text-sanctuary-500 font-mono break-all max-w-md hover:text-primary-500 dark:hover:text-primary-400 hover:underline inline-flex items-center"
      title={`View address ${address} on block explorer`}
    >
      {address}
      <ExternalLink className="w-2.5 h-2.5 ml-1 flex-shrink-0" />
    </a>
  );
}
