import React from "react";
import { Plus } from "lucide-react";
import { Button } from "./Button";

// Bespoke SVG illustration: minimalist vault door
const VaultIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 80 80"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="10"
      y="14"
      width="60"
      height="52"
      rx="4"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity="0.3"
    />
    <rect
      x="16"
      y="20"
      width="48"
      height="40"
      rx="2"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.2"
    />
    <circle
      cx="40"
      cy="40"
      r="12"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity="0.4"
    />
    <circle cx="40" cy="40" r="3" fill="currentColor" opacity="0.3" />
    <line
      x1="40"
      y1="28"
      x2="40"
      y2="34"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.25"
    />
    <line
      x1="40"
      y1="46"
      x2="40"
      y2="52"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.25"
    />
    <line
      x1="28"
      y1="40"
      x2="34"
      y2="40"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.25"
    />
    <line
      x1="46"
      y1="40"
      x2="52"
      y2="40"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.25"
    />
    {/* Handle */}
    <rect
      x="56"
      y="35"
      width="8"
      height="10"
      rx="2"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.2"
    />
  </svg>
);

// Bespoke SVG illustration: single key
const KeyIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 80 80"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="30"
      cy="40"
      r="14"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity="0.3"
    />
    <circle
      cx="30"
      cy="40"
      r="6"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.2"
    />
    <line
      x1="44"
      y1="40"
      x2="68"
      y2="40"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity="0.35"
    />
    <line
      x1="58"
      y1="40"
      x2="58"
      y2="48"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.25"
    />
    <line
      x1="64"
      y1="40"
      x2="64"
      y2="46"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.25"
    />
  </svg>
);

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
  compact?: boolean;
  illustration?: "vault" | "key";
}

function runEmptyStateAction(actionTo?: string, onAction?: () => void) {
  if (actionTo) {
    window.location.hash = actionTo;
    return;
  }
  onAction?.();
}

function getIllustrationComponent(illustration?: "vault" | "key") {
  if (illustration === "vault") return VaultIllustration;
  if (illustration === "key") return KeyIllustration;
  return null;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  compact = false,
  illustration,
}) => {
  if (compact) {
    return (
      <div className="py-3 px-4 text-center">
        <p className="text-xs text-sanctuary-400 dark:text-sanctuary-500">
          {title}
        </p>
        {actionLabel && (
          <button
            onClick={() => runEmptyStateAction(actionTo, onAction)}
            className="mt-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            {actionLabel}
          </button>
        )}
      </div>
    );
  }

  const IllustrationComponent = getIllustrationComponent(illustration);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center animate-fade-in-up">
      {IllustrationComponent ? (
        <div className="mb-5 relative">
          <IllustrationComponent className="w-20 h-20 text-primary-400 dark:text-primary-500" />
          {/* Ambient glow behind illustration */}
          <div className="absolute inset-0 bg-primary-100/30 dark:bg-primary-900/10 rounded-full blur-xl -z-10" />
        </div>
      ) : icon ? (
        <div className="mb-5 p-5 rounded-xl border border-dashed border-primary-200 dark:border-primary-800/50 bg-primary-50/30 dark:bg-primary-900/10">
          {React.isValidElement(icon)
            ? React.cloneElement(
                icon as React.ReactElement<{ className?: string }>,
                {
                  className:
                    (
                      (icon as React.ReactElement<{ className?: string }>).props
                        .className || ""
                    ).replace(/text-sanctuary-\d+/g, "") +
                    " text-primary-400 dark:text-primary-500",
                },
              )
            : icon}
        </div>
      ) : null}
      <h4 className="text-base font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
        {title}
      </h4>
      {description && (
        <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 max-w-sm mb-4">
          {description}
        </p>
      )}
      {actionLabel && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => runEmptyStateAction(actionTo, onAction)}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
};

export const WalletEmptyState: React.FC<{ network?: string }> = ({
  network = "mainnet",
}) => (
  <EmptyState
    illustration="vault"
    title={`No ${network} wallets yet`}
    description={`Create or import a ${network} wallet to start managing your Bitcoin.`}
    actionLabel="Create Wallet"
    actionTo="/wallets/create"
  />
);

export const DeviceEmptyState: React.FC = () => (
  <EmptyState
    illustration="key"
    title="No devices connected"
    description="Connect a hardware wallet to sign transactions securely."
    actionLabel="Connect Device"
    actionTo="/devices/connect"
  />
);
