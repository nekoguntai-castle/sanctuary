import React from 'react';
import { X, ExternalLink, Heart, Zap, Copy, Check, FileText } from 'lucide-react';
import { SanctuaryLogo } from '../ui/CustomIcons';
import { version } from '../../package.json';
import { QRCodeSVG } from 'qrcode.react';
import * as adminApi from '../../src/api/admin';

interface AboutModalProps {
  show: boolean;
  onClose: () => void;
  versionInfo: adminApi.VersionInfo | null;
  versionLoading: boolean;
  copiedAddress: string | null;
  onCopyAddress: (text: string, type: string) => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  show,
  onClose,
  versionInfo,
  versionLoading,
  copiedAddress,
  onCopyAddress,
}) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative surface-elevated rounded-xl shadow-2xl border border-sanctuary-200 dark:border-sanctuary-700 max-w-md w-full max-h-[90vh] overflow-y-auto animate-modal-enter">
        {/* Header */}
        <div className="p-6 border-b border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <SanctuaryLogo className="h-8 w-8 text-primary-600 dark:text-primary-400" />
              <div>
                <h2 className="text-xl font-semibold text-sanctuary-900 dark:text-sanctuary-50">
                  Sanctuary
                </h2>
                <p className="text-sm text-sanctuary-500">
                  v{version}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-sanctuary-400 hover:text-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Update Status */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-sanctuary-500 uppercase tracking-wide">
              Version Status
            </h3>
            {versionLoading ? (
              <div className="flex items-center space-x-2 text-sanctuary-500">
                <div className="animate-spin h-4 w-4 border border-sanctuary-300 border-t-sanctuary-600 rounded-full" />
                <span className="text-sm">Checking for updates...</span>
              </div>
            ) : versionInfo?.updateAvailable ? (
              <div className="p-3 rounded-lg bg-success-50 dark:bg-success-900/30 border border-success-200 dark:border-success-700">
                <div className="flex items-center space-x-2 text-success-700 dark:text-success-300">
                  <Zap className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    Update available: v{versionInfo.latestVersion}
                  </span>
                </div>
                {versionInfo.releaseName && (
                  <p className="text-xs text-success-600 dark:text-success-400 mt-1">
                    {versionInfo.releaseName}
                  </p>
                )}
                <a
                  href={versionInfo.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-xs text-success-700 dark:text-success-300 hover:underline mt-2"
                >
                  <span>View release notes</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <div className="p-3 rounded-lg surface-secondary">
                <div className="flex items-center space-x-2 text-sanctuary-600 dark:text-sanctuary-400">
                  <Check className="h-4 w-4 text-success-500" />
                  <span className="text-sm">You're running the latest version</span>
                </div>
              </div>
            )}
          </div>

          {/* Links */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-sanctuary-500 uppercase tracking-wide">
              Project
            </h3>
            <div className="space-y-2">
              <a
                href="https://github.com/nekoguntai/sanctuary"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-lg surface-secondary hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <svg className="h-5 w-5 text-sanctuary-600 dark:text-sanctuary-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                  <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                    GitHub Repository
                  </span>
                </div>
                <ExternalLink className="h-4 w-4 text-sanctuary-400" />
              </a>
              <a
                href="https://github.com/nekoguntai/sanctuary/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-lg surface-secondary hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <FileText className="h-5 w-5 text-sanctuary-600 dark:text-sanctuary-400" />
                  <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                    Release Notes
                  </span>
                </div>
                <ExternalLink className="h-4 w-4 text-sanctuary-400" />
              </a>
            </div>
          </div>

          {/* Support / Donations */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-sanctuary-500 uppercase tracking-wide flex items-center space-x-1">
              <Heart className="h-4 w-4 text-rose-500" />
              <span>Support This Project</span>
            </h3>
            <p className="text-xs text-sanctuary-500">
              Sanctuary is free and open source. If you find it useful, consider supporting development.
            </p>
            <div className="space-y-3 mt-3">
              {/* Bitcoin Address */}
              <DonationSection
                label="Bitcoin"
                address="bc1qhxsgrh8v3awf3pyc42847z2e7zgygqe05lgekn"
                qrValue="bitcoin:bc1qhxsgrh8v3awf3pyc42847z2e7zgygqe05lgekn"
                copyType="btc"
                copiedAddress={copiedAddress}
                onCopy={onCopyAddress}
                qrSize={128}
              />

              {/* Lightning Address */}
              <DonationSection
                label="Lightning Address"
                labelIcon={<Zap className="h-3 w-3 text-amber-500" />}
                address="carpalbutton44@phoenixwallet.me"
                qrValue="lightning:carpalbutton44@phoenixwallet.me"
                copyType="ln"
                copiedAddress={copiedAddress}
                onCopy={onCopyAddress}
                qrSize={128}
              />

              {/* BOLT12 Offer */}
              <DonationSection
                label="BOLT12 Offer"
                labelIcon={<Zap className="h-3 w-3 text-amber-500" />}
                address="lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy"
                qrValue="lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy"
                copyType="bolt12"
                copiedAddress={copiedAddress}
                onCopy={onCopyAddress}
                qrSize={160}
                addressClassName="text-[10px] leading-tight"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-sanctuary-200 dark:border-sanctuary-800 text-center">
          <p className="text-xs text-sanctuary-400">
            Made with ❤️ for Bitcoin self-custody
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * Reusable donation section with QR code and copy button.
 */
interface DonationSectionProps {
  label: string;
  labelIcon?: React.ReactNode;
  address: string;
  qrValue: string;
  copyType: string;
  copiedAddress: string | null;
  onCopy: (text: string, type: string) => void;
  qrSize: number;
  addressClassName?: string;
}

const DonationSection: React.FC<DonationSectionProps> = ({
  label,
  labelIcon,
  address,
  qrValue,
  copyType,
  copiedAddress,
  onCopy,
  qrSize,
  addressClassName,
}) => (
  <div className="p-3 rounded-lg surface-secondary">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium text-sanctuary-500 uppercase flex items-center space-x-1">
        {labelIcon && labelIcon}
        <span>{label}</span>
      </span>
      <button
        onClick={() => onCopy(address, copyType)}
        className="flex items-center space-x-1 text-xs text-primary-600 dark:text-primary-400 hover:underline"
      >
        {copiedAddress === copyType ? (
          <>
            <Check className="h-3 w-3 text-success-500 animate-copy-bounce" />
            <span className="text-success-600 dark:text-success-400">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
    <div className="flex flex-col items-center space-y-2">
      <div className="bg-white p-2 rounded-lg">
        <QRCodeSVG value={qrValue} size={qrSize} level="L" />
      </div>
      <code className={`text-xs text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono text-center ${addressClassName || ''}`}>
        {address}
      </code>
    </div>
  </div>
);
