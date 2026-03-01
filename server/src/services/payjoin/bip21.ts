/**
 * BIP21 URI Parsing and Generation
 *
 * Handles Bitcoin payment URIs with optional Payjoin endpoint (pj= parameter).
 */

/**
 * Parse a BIP21 URI and extract Payjoin URL if present
 */
export function parseBip21Uri(uri: string): {
  address: string;
  amount?: number;
  label?: string;
  message?: string;
  payjoinUrl?: string;
} {
  // Handle bitcoin: prefix
  let cleanUri = uri;
  if (cleanUri.toLowerCase().startsWith('bitcoin:')) {
    cleanUri = cleanUri.substring(8);
  }

  // Split address and params
  const [addressPart, paramsPart] = cleanUri.split('?');
  const address = addressPart;

  const result: ReturnType<typeof parseBip21Uri> = { address };

  if (paramsPart) {
    const params = new URLSearchParams(paramsPart);

    if (params.has('amount')) {
      result.amount = parseFloat(params.get('amount')!) * 100_000_000; // BTC to sats
    }
    if (params.has('label')) {
      result.label = decodeURIComponent(params.get('label')!);
    }
    if (params.has('message')) {
      result.message = decodeURIComponent(params.get('message')!);
    }
    if (params.has('pj')) {
      result.payjoinUrl = decodeURIComponent(params.get('pj')!);
    }
  }

  return result;
}

/**
 * Generate a BIP21 URI with optional Payjoin endpoint
 */
export function generateBip21Uri(
  address: string,
  options?: {
    amount?: number; // in satoshis
    label?: string;
    message?: string;
    payjoinUrl?: string;
  }
): string {
  let uri = `bitcoin:${address}`;
  const params: string[] = [];

  if (options?.amount) {
    params.push(`amount=${(options.amount / 100_000_000).toFixed(8)}`);
  }
  if (options?.label) {
    params.push(`label=${encodeURIComponent(options.label)}`);
  }
  if (options?.message) {
    params.push(`message=${encodeURIComponent(options.message)}`);
  }
  if (options?.payjoinUrl) {
    params.push(`pj=${encodeURIComponent(options.payjoinUrl)}`);
  }

  if (params.length > 0) {
    uri += '?' + params.join('&');
  }

  return uri;
}
