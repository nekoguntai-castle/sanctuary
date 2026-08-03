import { ExternalLink } from 'lucide-react';
import { getAddressExplorerUrl } from '../../../utils/explorer';

interface UtxoAddressLinkProps {
  address: string;
  network: string;
  explorerUrl: string;
}

export function UtxoAddressLink({ address, network, explorerUrl }: UtxoAddressLinkProps) {
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
