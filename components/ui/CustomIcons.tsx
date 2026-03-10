import React from 'react';
import { HardwareDevice, WalletType, isMultisigType } from '../../types';
import { Key } from 'lucide-react';

interface IconProps {
  className?: string;
}

// --- Sats Symbol Icon ---
// 3 horizontal lines with 1 vertical line through the center
export const SatsIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Three horizontal lines */}
    <line x1="6" y1="7" x2="18" y2="7" />
    <line x1="6" y1="12" x2="18" y2="12" />
    <line x1="6" y1="17" x2="18" y2="17" />
    {/* Single vertical line through all horizontals */}
    <line x1="12" y1="4" x2="12" y2="20" />
  </svg>
);

// --- App Logo ---
// "Sanctuary Stack": Layers of security forming a secure foundation.
// Geometric, minimalist, and resembling a vault or a stack of coins/servers.
// The circle sits on the TOP diamond layer, not the center.
export const SanctuaryLogo: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" fillOpacity="0.5" />
  </svg>
);

// --- Wallet Type Icons ---

// "The Master Key": Represents a single point of entry/control.
export const SingleSigIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Key Head */}
    <circle cx="13.5" cy="10.5" r="5.5" />
    <circle cx="13.5" cy="10.5" r="2" fill="currentColor" fillOpacity="0.1" />
    {/* Key Shaft */}
    <path d="M9.5 14.5L4 20" />
    {/* Teeth */}
    <path d="M4 20l2-2" />
    <path d="M4 20l-1-1" />
  </svg>
);

// "Network Nodes": Connected nodes representing distributed trust and multiparty collaboration.
export const MultiSigIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Connection lines between nodes */}
    <path d="M12 4L4 18" opacity="0.4" />
    <path d="M12 4L20 18" opacity="0.4" />
    <path d="M4 18L20 18" opacity="0.4" />
    {/* Inner connections to center */}
    <path d="M12 4L12 12" opacity="0.2" />
    <path d="M4 18L12 12" opacity="0.2" />
    <path d="M20 18L12 12" opacity="0.2" />
    {/* Network nodes - outer vertices */}
    <circle cx="12" cy="4" r="2.5" fill="currentColor" fillOpacity="0.15" />
    <circle cx="4" cy="18" r="2.5" fill="currentColor" fillOpacity="0.15" />
    <circle cx="20" cy="18" r="2.5" fill="currentColor" fillOpacity="0.15" />
    {/* Center node - represents the collaborative result */}
    <circle cx="12" cy="12" r="2" fill="currentColor" fillOpacity="0.3" />
    {/* Node cores */}
    <circle cx="12" cy="4" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
    <circle cx="20" cy="18" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" />
  </svg>
);

export const getWalletIcon = (type: WalletType | string, className?: string) => {
  return isMultisigType(type)
    ? <MultiSigIcon className={className} />
    : <SingleSigIcon className={className} />;
};


// --- Hardware Device Icons ---

const ColdCardMk4Icon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="6" y="2" width="12" height="20" rx="2" />
    <rect x="8" y="5" width="8" height="6" rx="1" />
    <circle cx="9" cy="15" r="0.5" fill="currentColor" />
    <circle cx="12" cy="15" r="0.5" fill="currentColor" />
    <circle cx="15" cy="15" r="0.5" fill="currentColor" />
    <circle cx="9" cy="17" r="0.5" fill="currentColor" />
    <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    <circle cx="15" cy="17" r="0.5" fill="currentColor" />
    <circle cx="9" cy="19" r="0.5" fill="currentColor" />
    <circle cx="12" cy="19" r="0.5" fill="currentColor" />
    <circle cx="15" cy="19" r="0.5" fill="currentColor" />
  </svg>
);

const ColdCardQIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <rect x="5" y="6" width="14" height="6" rx="1" />
    <path d="M4 14h16" strokeDasharray="2 2" />
    <path d="M4 17h16" strokeDasharray="2 2" />
    <circle cx="18" cy="15.5" r="1" />
  </svg>
);

const TrezorIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M7 4h10l3 5v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9l3-5z" />
    <rect x="8" y="8" width="8" height="6" rx="1" />
    <path d="M12 17v1" />
  </svg>
);

const TrezorSafe7Icon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Trezor Safe 7: Slim rectangular body with large touchscreen */}
    <rect x="6" y="2" width="12" height="20" rx="2.5" />
    {/* Large color touchscreen (edge-to-edge look) */}
    <rect x="7.5" y="3.5" width="9" height="15" rx="1" fill="currentColor" fillOpacity="0.1" />
    {/* Screen content hint - shield/lock icon */}
    <path d="M12 7v4" />
    <path d="M10 9h4" />
    <circle cx="12" cy="14" r="1.5" />
    {/* USB-C port at bottom */}
    <rect x="10" y="20" width="4" height="1" rx="0.5" fill="currentColor" fillOpacity="0.3" />
  </svg>
);

const LedgerNanoIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Device Body */}
    <rect x="4" y="8" width="16" height="8" rx="4" />
    {/* Screen */}
    <rect x="8" y="10" width="8" height="4" rx="1" fill="currentColor" fillOpacity="0.1" />
    {/* Buttons */}
    <circle cx="6" cy="12" r="1" />
    <circle cx="18" cy="12" r="1" />
    {/* Swivel Hinge/Cover hint */}
    <path d="M16 8c2.2 0 4 1.8 4 4s-1.8 4-4 4" opacity="0.5" />
  </svg>
);

const LedgerStaxIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Body */}
    <rect x="6" y="3" width="14" height="18" rx="1" />
    {/* Curved Spine */}
    <path d="M6 3c-2 0-3 1-3 3v12c0 2 1 3 3 3" />
    {/* Screen Area hint */}
    <path d="M8 3v18" strokeDasharray="1 2" opacity="0.5" />
    <rect x="10" y="6" width="7" height="12" rx="0.5" opacity="0.3" />
  </svg>
);

const LedgerFlexIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Main Body */}
    <rect x="4" y="3" width="16" height="18" rx="2" />
    {/* E-ink Screen */}
    <rect x="6" y="5" width="12" height="14" rx="1" opacity="0.8" />
    {/* Bottom Bezel/Button area */}
    <path d="M12 20v1" />
  </svg>
);

const LedgerGen5Icon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Ledger Gen 5: Premium credit card form factor with edge-to-edge display */}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    {/* Full touchscreen display */}
    <rect x="4.5" y="5.5" width="15" height="13" rx="1" fill="currentColor" fillOpacity="0.1" />
    {/* Ledger logo hint on screen */}
    <path d="M8 10h3v4h5" />
    {/* Secure element indicator */}
    <circle cx="17" cy="8" r="1" fill="currentColor" fillOpacity="0.3" />
    {/* USB-C port on side */}
    <rect x="21" y="11" width="1" height="2" rx="0.3" fill="currentColor" fillOpacity="0.3" />
  </svg>
);

const BitBoxIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9 3h6v4h-6z" />
    <path d="M7 7h10v14H7z" />
    <path d="M12 12l2 2" />
    <path d="M12 12l-2 2" />
  </svg>
);

const FoundationPassportIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Body */}
    <rect x="6" y="2" width="12" height="20" rx="2" />
    {/* Screen */}
    <rect x="8" y="5" width="8" height="8" rx="1" />
    {/* Keypad area hint */}
    <path d="M8 15h8" />
    <path d="M8 18h8" />
    <path d="M12 15v3" />
  </svg>
);

const BlockstreamJadeIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {/* Body */}
    <rect x="4" y="6" width="16" height="12" rx="2" />
    {/* Screen */}
    <rect x="7" y="8" width="6" height="8" rx="1" />
    {/* Camera/Button bump area */}
    <circle cx="16" cy="12" r="2" />
    <path d="M16 10l-1 2 1 2 1-2z" fill="currentColor" fillOpacity="0.2" stroke="none"/>
  </svg>
);

const KeystoneIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
     {/* Body like a smartphone */}
     <rect x="5" y="2" width="14" height="20" rx="3" />
     {/* Screen */}
     <rect x="7" y="5" width="10" height="10" rx="1" />
     {/* Fingerprint/Home button area */}
     <circle cx="12" cy="19" r="1.5" />
  </svg>
);

export const getDeviceIcon = (type: HardwareDevice | string, className?: string) => {
  // Normalize type to lowercase for matching
  const normalizedType = typeof type === 'string' ? type.toLowerCase() : '';

  // Match against enum values or string patterns
  if (type === HardwareDevice.COLDCARD_MK4 || normalizedType.includes('coldcard') && (normalizedType.includes('mk4') || normalizedType.includes('mk3'))) {
    return <ColdCardMk4Icon className={className} />;
  }
  if (type === HardwareDevice.COLDCARD_Q || normalizedType.includes('coldcard') && normalizedType.includes('q')) {
    return <ColdCardQIcon className={className} />;
  }
  if (type === HardwareDevice.TREZOR_SAFE_7 || normalizedType.includes('trezor') && (normalizedType.includes('safe 7') || normalizedType.includes('safe_7'))) {
    return <TrezorSafe7Icon className={className} />;
  }
  if (type === HardwareDevice.TREZOR || normalizedType.includes('trezor')) {
    return <TrezorIcon className={className} />;
  }
  if (type === HardwareDevice.LEDGER_STAX || normalizedType.includes('ledger') && normalizedType.includes('stax')) {
    return <LedgerStaxIcon className={className} />;
  }
  if (type === HardwareDevice.LEDGER_FLEX || normalizedType.includes('ledger') && normalizedType.includes('flex')) {
    return <LedgerFlexIcon className={className} />;
  }
  if (type === HardwareDevice.LEDGER_GEN_5 || normalizedType.includes('ledger') && (normalizedType.includes('gen 5') || normalizedType.includes('gen_5'))) {
    return <LedgerGen5Icon className={className} />;
  }
  if (type === HardwareDevice.LEDGER || normalizedType.includes('ledger') && normalizedType.includes('nano')) {
    return <LedgerNanoIcon className={className} />;
  }
  if (type === HardwareDevice.BITBOX || normalizedType.includes('bitbox')) {
    return <BitBoxIcon className={className} />;
  }
  if (type === HardwareDevice.FOUNDATION_PASSPORT || normalizedType.includes('passport') || normalizedType.includes('foundation')) {
    return <FoundationPassportIcon className={className} />;
  }
  if (type === HardwareDevice.BLOCKSTREAM_JADE || normalizedType.includes('jade') || normalizedType.includes('blockstream')) {
    return <BlockstreamJadeIcon className={className} />;
  }
  if (type === HardwareDevice.KEYSTONE || normalizedType.includes('keystone')) {
    return <KeystoneIcon className={className} />;
  }
  // Default for generic or unknown devices
  return <Key className={className} />;
};
