/**
 * AddressQRModal Component
 *
 * Simple modal for displaying an address as a QR code with copy functionality.
 */

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Copy, Check } from 'lucide-react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';

interface AddressQRModalProps {
  address: string;
  onClose: () => void;
}

export const AddressQRModal: React.FC<AddressQRModalProps> = ({
  address,
  onClose,
}) => {
  const { copy, isCopied } = useCopyToClipboard();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="surface-elevated rounded-2xl max-w-sm w-full p-6 shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 animate-modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Address QR Code
          </h3>
          <button
            onClick={onClose}
            className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col items-center">
          <div className="bg-white p-4 rounded-xl mb-4">
            <QRCodeSVG value={address} size={200} level="M" />
          </div>

          <div className="w-full">
            <label className="block text-xs font-medium text-sanctuary-500 mb-1">
              Full Address
            </label>
            <div className="flex items-center space-x-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg p-3">
              <span className="text-xs font-mono text-sanctuary-700 dark:text-sanctuary-300 break-all flex-1">
                {address}
              </span>
              <button
                onClick={() => copy(address)}
                className={`flex-shrink-0 transition-colors ${
                  isCopied(address)
                    ? 'text-success-500'
                    : 'text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300'
                }`}
                title={isCopied(address) ? 'Copied!' : 'Copy address'}
              >
                {isCopied(address) ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
