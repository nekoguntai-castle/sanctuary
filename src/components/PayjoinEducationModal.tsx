import { useEffect } from 'react';
import { Shield, X, Check, ExternalLink } from 'lucide-react';

interface PayjoinEducationModalProps {
  onClose: () => void;
}

export function PayjoinEducationModal({ onClose }: PayjoinEducationModalProps) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg surface-elevated rounded-xl shadow-xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 surface-elevated">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Understanding Payjoin
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              The Problem
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              Bitcoin transactions are public. Chain analysis companies use a simple rule:
              "All inputs in a transaction probably belong to the same person." This lets
              them track your bitcoin across transactions.
            </p>

            <div className="mt-3 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <div className="text-xs font-medium text-rose-700 dark:text-rose-300 mb-2">
                Normal Transaction
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex flex-col gap-1">
                  <span className="px-2 py-1 bg-rose-100 dark:bg-rose-800/50 rounded text-rose-700 dark:text-rose-300">Sender's coin</span>
                  <span className="px-2 py-1 bg-rose-100 dark:bg-rose-800/50 rounded text-rose-700 dark:text-rose-300">Sender's coin</span>
                </div>
                <span className="text-rose-400">→</span>
                <span className="px-2 py-1 bg-rose-100 dark:bg-rose-800/50 rounded text-rose-700 dark:text-rose-300">Receiver</span>
              </div>
              <p className="mt-2 text-[10px] text-rose-600 dark:text-rose-400">
                ↑ Chain analysis assumes these are from the same person
              </p>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              The Solution: Payjoin
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              Payjoin breaks this assumption. When you receive with Payjoin enabled, you
              contribute one of your coins to the transaction. Now the inputs come from
              multiple people, breaking the chain analysis rule.
            </p>

            <div className="mt-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-2">
                Payjoin Transaction
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex flex-col gap-1">
                  <span className="px-2 py-1 bg-blue-100 dark:bg-blue-800/50 rounded text-blue-700 dark:text-blue-300">Sender's coin</span>
                  <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-800/50 rounded text-emerald-700 dark:text-emerald-300">Your coin</span>
                </div>
                <span className="text-emerald-400">→</span>
                <div className="flex flex-col gap-1">
                  <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-800/50 rounded text-emerald-700 dark:text-emerald-300">You (payment + your coin)</span>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-emerald-600 dark:text-emerald-400">
                ✓ Mixed inputs break the "same owner" assumption
              </p>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              When to Use It
            </h3>
            <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-1">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Receiving payments you want to keep private</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>When the sender uses a Payjoin-capable wallet</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>When you have confirmed bitcoin available</span>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              When It Won't Work
            </h3>
            <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-1">
              <li className="flex items-start gap-2">
                <X className="w-4 h-4 text-sanctuary-400 mt-0.5 flex-shrink-0" />
                <span>If the sender's wallet doesn't support Payjoin</span>
              </li>
              <li className="flex items-start gap-2">
                <X className="w-4 h-4 text-sanctuary-400 mt-0.5 flex-shrink-0" />
                <span>If your server goes offline before they send</span>
              </li>
              <li className="flex items-start gap-2">
                <X className="w-4 h-4 text-sanctuary-400 mt-0.5 flex-shrink-0" />
                <span>If you have no confirmed coins to contribute</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-sanctuary-500 dark:text-sanctuary-400 p-3 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800/50">
              <strong>Don't worry:</strong> If Payjoin fails, the sender will still complete
              a normal payment. They won't even know Payjoin didn't happen.
            </p>
          </section>

          <div className="pt-2">
            <a
              href="https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
            >
              Read the BIP78 specification
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
