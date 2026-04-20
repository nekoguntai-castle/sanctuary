import { ArrowRight, Check } from 'lucide-react';
import { AnimatedQRCode } from '../AnimatedQRCode';

type QRSigningDisplayStepProps = {
  deviceLabel: string;
  psbtBase64: string;
  onContinue: () => void;
};

export function QRSigningDisplayStep({
  deviceLabel,
  psbtBase64,
  onContinue,
}: QRSigningDisplayStepProps) {
  return (
    <div className="flex flex-col items-center">
      <DisplayStepIndicator />
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 text-center mb-4">
        Scan this QR code with your {deviceLabel} to receive the transaction for signing.
      </p>
      <AnimatedQRCode psbtBase64={psbtBase64} size={260} frameInterval={200} />
      <button
        onClick={onContinue}
        className="mt-6 w-full flex items-center justify-center px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors"
      >
        <Check className="w-4 h-4 mr-2" />
        I've Signed It
        <ArrowRight className="w-4 h-4 ml-2" />
      </button>
    </div>
  );
}

function DisplayStepIndicator() {
  return (
    <div className="flex items-center text-sm text-sanctuary-500 mb-4">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary-500 text-white mr-2">
        1
      </span>
      <span className="font-medium">Show to device</span>
      <ArrowRight className="w-4 h-4 mx-3 text-sanctuary-300" />
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 mr-2">
        2
      </span>
      <span className="text-sanctuary-400">Scan signed</span>
    </div>
  );
}
