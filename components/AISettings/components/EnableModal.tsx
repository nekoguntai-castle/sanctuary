import { Brain, X } from "lucide-react";
import type { EnableModalProps } from "../types";

export function EnableModal({
  showEnableModal,
  onClose,
  onEnable,
}: EnableModalProps) {
  if (!showEnableModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-sanctuary-900 rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-sanctuary-200 dark:border-sanctuary-700">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <Brain className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">
              Enable AI Features
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
          >
            <X className="w-5 h-5 text-sanctuary-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              AI features use an OpenAI-compatible chat endpoint. You can use
              bundled Ollama, host-installed Ollama, LM Studio, llama.cpp, or
              another trusted local or LAN provider.
            </p>
          </div>

          <div className="text-xs text-sanctuary-500 space-y-2">
            <div>
              <strong>Deployment options:</strong>
            </div>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li>
                <strong>Bundled Ollama</strong> — start the local container from
                the Status tab after enabling
              </li>
              <li>
                <strong>Host Ollama</strong> — use Ollama running directly on
                your host OS
              </li>
              <li>
                <strong>OpenAI-compatible server</strong> — use LM Studio,
                llama.cpp, or another LAN endpoint
              </li>
            </ul>
          </div>

          <div className="p-3 rounded-lg surface-secondary">
            <p className="text-xs text-sanctuary-500">
              After enabling, go to the <strong>Settings</strong> tab to choose
              the provider type, configure the endpoint, and select a model.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-4 border-t border-sanctuary-200 dark:border-sanctuary-700 bg-sanctuary-50 dark:bg-sanctuary-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onEnable}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 rounded-lg transition-colors"
          >
            Enable AI
          </button>
        </div>
      </div>
    </div>
  );
}
