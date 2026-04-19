import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { RefreshCw } from 'lucide-react';

interface ReceiveQrCodeProps {
  value: string;
  loading: boolean;
}

export const ReceiveQrCode: React.FC<ReceiveQrCodeProps> = ({ value, loading }) => (
  <div className="bg-white p-4 rounded-lg mb-4 shadow-sm">
    {loading ? (
      <div className="w-[200px] h-[200px] flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-sanctuary-400" />
      </div>
    ) : (
      <QRCodeSVG value={value} size={200} level="M" />
    )}
  </div>
);
