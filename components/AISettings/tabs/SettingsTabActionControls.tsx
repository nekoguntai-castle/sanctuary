import type { SettingsTabProps } from "../types";

type ActionButtonsProps = Pick<
  SettingsTabProps,
  | "isSaving"
  | "aiEndpoint"
  | "aiModel"
  | "aiStatus"
  | "onSaveConfig"
  | "onTestConnection"
>;

export function ActionButtons({
  isSaving,
  aiEndpoint,
  aiModel,
  aiStatus,
  onSaveConfig,
  onTestConnection,
}: ActionButtonsProps) {
  return (
    <div className="flex items-center space-x-3">
      <button
        onClick={onSaveConfig}
        disabled={isSaving || !aiEndpoint}
        className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded-lg disabled:opacity-50 transition-colors"
      >
        {isSaving ? "Saving..." : "Save Configuration"}
      </button>
      <button
        onClick={onTestConnection}
        disabled={aiStatus === "checking" || !aiEndpoint || !aiModel}
        className="px-4 py-2 border border-sanctuary-300 dark:border-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 rounded-lg disabled:opacity-50 transition-colors"
      >
        {aiStatus === "checking" ? "Testing..." : "Test Connection"}
      </button>
    </div>
  );
}
