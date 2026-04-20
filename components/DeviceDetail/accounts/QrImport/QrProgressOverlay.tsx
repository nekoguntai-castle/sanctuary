import React from 'react';
import { Loader2 } from 'lucide-react';

interface QrProgressOverlayProps {
  progress: number;
}

export const QrProgressOverlay: React.FC<QrProgressOverlayProps> = ({ progress }) => (
  <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-3 z-10">
    <div className="flex items-center justify-between text-white mb-2">
      <span className="flex items-center text-sm font-medium">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Scanning...
      </span>
      <span className="text-lg font-bold">{progress}%</span>
    </div>
    <div className="w-full bg-white/20 rounded-full h-2">
      <div
        className="bg-green-400 h-2 rounded-full transition-all duration-300"
        style={{ width: `${progress}%` }}
      />
    </div>
  </div>
);
