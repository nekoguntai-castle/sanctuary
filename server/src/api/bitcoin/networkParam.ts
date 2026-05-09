import { InvalidInputError } from '../../errors/ApiError';
import { isBitcoinNetwork, type BitcoinNetwork } from '../../services/bitcoin/networks';

export function resolveBitcoinNetworkParam(
  value: unknown,
  field: string = 'network'
): BitcoinNetwork {
  if (value === undefined || value === null || value === '') {
    return 'mainnet';
  }

  if (value === 'testnet') {
    return 'testnet3';
  }

  if (isBitcoinNetwork(value)) {
    return value;
  }

  throw new InvalidInputError('Invalid Bitcoin network', field, { network: value });
}
