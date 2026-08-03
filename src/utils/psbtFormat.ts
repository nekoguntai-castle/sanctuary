export const PSBT_MAGIC_TEXT = 'psbt';
export const PSBT_SEPARATOR_BYTE = 0xff;
export const PSBT_MAGIC_BYTES = [0x70, 0x73, 0x62, 0x74] as const;

export const BASE64_TEXT_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
export const HEX_TEXT_PATTERN = /^[0-9a-fA-F\s]+$/;

export function hasPsbtMagicBytes(bytes: ArrayLike<number>): boolean {
  if (bytes.length < PSBT_MAGIC_BYTES.length) return false;

  return PSBT_MAGIC_BYTES.every((magicByte, index) => bytes[index] === magicByte);
}

export function hasBip174BinaryPsbtMagic(bytes: ArrayLike<number>): boolean {
  return (
    bytes.length >= PSBT_MAGIC_BYTES.length + 1 &&
    hasPsbtMagicBytes(bytes) &&
    bytes[PSBT_MAGIC_BYTES.length] === PSBT_SEPARATOR_BYTE
  );
}

export function hasPsbtMagicText(text: string): boolean {
  return text.startsWith(PSBT_MAGIC_TEXT);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binaryString.length));

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

export function bytesToBase64(bytes: ArrayLike<number>): string {
  let binaryString = '';

  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }

  return btoa(binaryString);
}

export function hexTextToBytes(content: string): Uint8Array {
  const cleanHex = content.replace(/\s/g, '');
  const hexPairs = cleanHex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(hexPairs.map(byte => parseInt(byte, 16)));
}
