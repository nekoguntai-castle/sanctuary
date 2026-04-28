import type { ReactNode } from "react";
import type { SettingsTabProps } from "../types";

type NextStepHintProps = Pick<
  SettingsTabProps,
  "providerType" | "aiEndpoint" | "aiModel" | "onNavigateToModels"
>;

export function NextStepHint({
  providerType,
  aiEndpoint,
  aiModel,
  onNavigateToModels,
}: NextStepHintProps) {
  if (!aiEndpoint || aiModel) return null;

  if (providerType === "openai-compatible") {
    return <OpenAICompatibleNextStep />;
  }

  return <OllamaNextStep onNavigateToModels={onNavigateToModels} />;
}

function OpenAICompatibleNextStep() {
  return (
    <HintContainer>
      <span className="font-medium">Next:</span> Enter the model identifier
      reported by your provider, or use Detect to list available models.
    </HintContainer>
  );
}

function OllamaNextStep({
  onNavigateToModels,
}: Pick<SettingsTabProps, "onNavigateToModels">) {
  return (
    <HintContainer>
      <span className="font-medium">Next:</span> Go to the{" "}
      <button onClick={onNavigateToModels} className="underline font-medium">
        Models
      </button>{" "}
      tab to download a model.
    </HintContainer>
  );
}

function HintContainer({ children }: { children: ReactNode }) {
  return (
    <div className="p-4 rounded-lg bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700">
      <p className="text-sm text-primary-700 dark:text-primary-700">
        {children}
      </p>
    </div>
  );
}
