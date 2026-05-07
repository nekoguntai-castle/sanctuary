import { AlertCircle, Loader2 } from "lucide-react";
import type { ModelDownloadProgress } from "../../../hooks/websocket";

function pullProgressClass(pullProgress: string) {
  if (pullProgress.includes("Successfully")) {
    return "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300";
  }

  if (pullProgress.includes("Failed") || pullProgress.includes("Error")) {
    return "bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300";
  }

  return "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300";
}

function progressLabel(
  downloadProgress: ModelDownloadProgress | null,
  pullProgress: string,
) {
  if (downloadProgress?.status === "pulling") {
    return "Pulling manifest...";
  }

  if (downloadProgress?.status === "verifying") {
    return "Verifying...";
  }

  return pullProgress;
}

export function ResourceNotice({
  canManageOllamaModels,
}: {
  canManageOllamaModels: boolean;
}) {
  return (
    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
      <div className="flex items-start space-x-2">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {canManageOllamaModels ? (
            <>
              Ollama models use <strong>2-8 GB disk</strong> and{" "}
              <strong>4-16 GB RAM</strong>. Smaller models (1-3B) work on most
              systems.
            </>
          ) : (
            <>
              OpenAI-compatible providers manage model downloads outside
              Sanctuary. Install or remove models in LM Studio or your provider
              app, then refresh the detected list here.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

interface PullProgressNoticeProps {
  pullProgress: string;
  downloadProgress: ModelDownloadProgress | null;
  isPulling: boolean;
  pullModelName: string;
  formatBytes: (bytes: number) => string;
}

export function PullProgressNotice({
  pullProgress,
  downloadProgress,
  isPulling,
  pullModelName,
  formatBytes,
}: PullProgressNoticeProps) {
  if (!pullProgress && !downloadProgress) {
    return null;
  }

  const isDownloading =
    downloadProgress?.status === "downloading" && downloadProgress.total > 0;

  return (
    <div className={`p-3 rounded-lg ${pullProgressClass(pullProgress)}`}>
      {isDownloading && downloadProgress ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Downloading {pullModelName}</span>
            </span>
            <span className="tabular-nums">{downloadProgress.percent}%</span>
          </div>
          <div className="w-full bg-primary-200/60 dark:bg-sanctuary-800 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-primary-500 to-primary-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress.percent}%` }}
            />
          </div>
          <div className="text-xs tabular-nums">
            {formatBytes(downloadProgress.completed)} /{" "}
            {formatBytes(downloadProgress.total)}
          </div>
        </div>
      ) : (
        <div className="flex items-center space-x-2">
          {isPulling && <Loader2 className="w-4 h-4 animate-spin" />}
          <span className="text-sm">
            {progressLabel(downloadProgress, pullProgress)}
          </span>
        </div>
      )}
    </div>
  );
}
