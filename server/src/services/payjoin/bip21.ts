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
    // URLSearchParams.get() already percent-decodes values — no need for decodeURIComponent
    const params = new URLSearchParams(paramsPart);

    const amount = params.get('amount');
    if (amount !== null) {
      result.amount = parseFloat(amount) * 100_000_000; // BTC to sats
    }
    const label = params.get('label');
    if (label !== null) {
      result.label = label;
    }
    const message = params.get('message');
    if (message !== null) {
      result.message = message;
    }
    const pj = params.get('pj');
    if (pj !== null) {
      result.payjoinUrl = pj;
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
