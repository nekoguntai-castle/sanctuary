import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { SettingsTabProps } from "../types";

type StatusMessagesProps = Pick<
  SettingsTabProps,
  "saveSuccess" | "saveError" | "aiStatus" | "aiStatusMessage"
>;

export function StatusMessages({
  saveSuccess,
  saveError,
  aiStatus,
  aiStatusMessage,
}: StatusMessagesProps) {
  return (
    <>
      {saveSuccess && <SaveSuccessMessage />}
      {saveError && <SaveErrorMessage message={saveError} />}
      {aiStatusMessage && (
        <ConnectionStatusMessage
          aiStatus={aiStatus}
          aiStatusMessage={aiStatusMessage}
        />
      )}
    </>
  );
}

function SaveSuccessMessage() {
  return (
    <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
      <Check className="w-4 h-4" />
      <span className="text-sm">Configuration saved</span>
    </div>
  );
}

function SaveErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
      <AlertCircle className="w-4 h-4" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

type ConnectionStatusMessageProps = Pick<
  SettingsTabProps,
  "aiStatus" | "aiStatusMessage"
>;

function ConnectionStatusMessage({
  aiStatus,
  aiStatusMessage,
}: ConnectionStatusMessageProps) {
  const statusClass = getConnectionStatusClass(aiStatus);

  return (
    <div className={`flex items-center space-x-2 ${statusClass}`}>
      <ConnectionStatusIcon aiStatus={aiStatus} />
      <span className="text-sm">{aiStatusMessage}</span>
    </div>
  );
}

function getConnectionStatusClass(
  aiStatus: SettingsTabProps["aiStatus"],
): string {
  if (aiStatus === "connected") return "text-emerald-600 dark:text-emerald-400";
  if (aiStatus === "error") return "text-rose-600 dark:text-rose-400";
  return "text-sanctuary-500";
}

function ConnectionStatusIcon({
  aiStatus,
}: Pick<SettingsTabProps, "aiStatus">) {
  if (aiStatus === "connected") return <Check className="w-4 h-4" />;
  if (aiStatus === "error") return <AlertCircle className="w-4 h-4" />;
  if (aiStatus === "checking") {
    return <Loader2 className="w-4 h-4 animate-spin" />;
  }
  return null;
}
