import { Download } from "lucide-react";

interface CustomModelInputProps {
  canManageOllamaModels: boolean;
  customModelName: string;
  isPulling: boolean;
  onPullModel: (model: string) => void;
  onCustomModelNameChange: (value: string) => void;
}

export function CustomModelInput({
  canManageOllamaModels,
  customModelName,
  isPulling,
  onPullModel,
  onCustomModelNameChange,
}: CustomModelInputProps) {
  const trimmedModelName = customModelName.trim();

  function pullCustomModel() {
    onPullModel(trimmedModelName);
    onCustomModelNameChange("");
  }

  return (
    <div className="pt-4 border-t border-sanctuary-200 dark:border-sanctuary-700">
      {canManageOllamaModels ? (
        <>
          <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Pull Any Ollama Model
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={customModelName}
              onChange={(e) => onCustomModelNameChange(e.target.value)}
              placeholder="e.g., qwen3:4b, llama3.2:3b"
              className="flex-1 px-3 py-2 text-sm rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 placeholder:text-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isPulling}
            />
            <button
              onClick={pullCustomModel}
              disabled={isPulling || !trimmedModelName}
              className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Pull</span>
            </button>
          </div>
          <p className="text-xs text-sanctuary-500 mt-1">
            Browse Ollama tags at{" "}
            <a
              href="https://ollama.com/library"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 dark:text-primary-400 hover:underline"
            >
              ollama.com/library
            </a>
          </p>
        </>
      ) : (
        <div className="p-4 rounded-lg surface-secondary">
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
            For LM Studio and other OpenAI-compatible providers, manage model
            downloads in the provider app, then use Refresh above or Detect in
            Settings to update Sanctuary's model list.
          </p>
        </div>
      )}
    </div>
  );
}
