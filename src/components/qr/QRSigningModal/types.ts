export type QRSigningStep = 'display' | 'scan';

export type QrScanResult = {
  rawValue: string;
};

export type SignedPsbtImportSource = 'binary' | 'base64' | 'hex';

export type SignedPsbtImport = {
  base64: string;
  source: SignedPsbtImportSource;
  size?: number;
};
