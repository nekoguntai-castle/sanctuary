import React from 'react';
import {
  Download,
  Upload,
  Trash2,
  Play,
  AlertCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { DraftTransaction } from '../../src/api/drafts';
import { TransactionFlowPreview } from '../TransactionFlowPreview';
import { WalletType } from '../../types';
import { Amount } from '../Amount';
import { FiatDisplaySubtle } from '../FiatDisplay';
import { truncateAddress } from '../../utils/formatters';
import { DraftRowProps } from './types';
import {
  getExpirationInfo,
  getFeeWarning,
  getFlowPreviewData,
  isExpired,
  formatDate,
} from './utils';

export const DraftRow: React.FC<DraftRowProps> = ({
  draft,
  walletType,
  quorum,
  canEdit,
  isExpanded,
  deleteConfirm,
  format,
  getAddressLabel,
  onResume,
  onDelete,
  onDownloadPsbt,
  onUploadPsbt,
  onToggleExpand,
  onSetDeleteConfirm,
}) => {
  const getStatusBadge = (d: DraftTransaction) => {
    switch (d.status) {
      case 'unsigned':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400">
            <Clock className="w-3 h-3" />
            Unsigned
          </span>
        );
      case 'partial': {
        const signedCount = d.signedDeviceIds?.length || 0;
        const requiredSigs = quorum?.m || 1;
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
            <AlertTriangle className="w-3 h-3" />
            {signedCount} of {requiredSigs} signed
          </span>
        );
      }
      case 'signed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
            <CheckCircle2 className="w-3 h-3" />
            Ready to broadcast
          </span>
        );
      default:
        return null;
    }
  };

  const getExpirationBadge = (d: DraftTransaction) => {
    const expInfo = getExpirationInfo(d.expiresAt);
    if (!expInfo) return null;

    switch (expInfo.urgency) {
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
            <AlertCircle className="w-3 h-3" />
            {expInfo.text}
          </span>
        );
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="w-3 h-3" />
            {expInfo.text}
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3" />
            {expInfo.text}
          </span>
        );
      case 'normal':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs text-sanctuary-400 dark:text-sanctuary-500">
            <Clock className="w-3 h-3" />
            {expInfo.text}
          </span>
        );
    }
  };

  const flowData = getFlowPreviewData(draft, getAddressLabel);
  const feeWarning = getFeeWarning(draft);
  const expired = isExpired(draft);
  const isAgentFundingDraft = Boolean(draft.agentId);
  const agentSignatureText = (draft.signedDeviceIds?.length || 0) > 0 ? 'present' : 'missing';

  return (
    <div
      className={`surface-elevated rounded-lg p-4 border ${
        expired
          ? 'border-rose-300 dark:border-rose-800 opacity-75'
          : 'border-sanctuary-200 dark:border-sanctuary-700'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs text-sanctuary-400">
              {formatDate(draft.createdAt)}
            </span>
            {getStatusBadge(draft)}
            {getExpirationBadge(draft)}
            {isAgentFundingDraft && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-shared-100 text-shared-800 dark:bg-shared-100 dark:text-shared-700">
                <Bot className="w-3 h-3" />
                Agent funding request
              </span>
            )}
          </div>

          <div className="mb-2">
            <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
              To:{' '}
            </span>
            {isAgentFundingDraft ? (
              <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
                Linked operational wallet{' '}
                <span className="font-mono text-sanctuary-500 dark:text-sanctuary-400">
                  {truncateAddress(draft.recipient)}
                </span>
              </span>
            ) : draft.outputs && draft.outputs.length > 0 ? (
              draft.outputs.length === 1 ? (
                <span className="font-mono text-sm text-sanctuary-700 dark:text-sanctuary-300">
                  {truncateAddress(draft.outputs[0].address)}
                </span>
              ) : (
                <div className="mt-1 space-y-1">
                  {draft.outputs.map((output, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-sanctuary-700 dark:text-sanctuary-300">
                        {truncateAddress(output.address)}
                      </span>
                      <span className="ml-2 text-sanctuary-600 dark:text-sanctuary-400 flex items-center gap-1">
                        {output.sendMax ? 'MAX' : format(output.amount)}
                        {!output.sendMax && (
                          <FiatDisplaySubtle sats={output.amount} size="xs" />
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <span className="font-mono text-sm text-sanctuary-700 dark:text-sanctuary-300">
                {truncateAddress(draft.recipient)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div>
              <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
                Amount:{' '}
              </span>
              <Amount
                sats={draft.effectiveAmount}
                className="font-medium text-sanctuary-900 dark:text-sanctuary-100"
              />
            </div>
            <div>
              <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
                Fee:{' '}
              </span>
              <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">
                {draft.fee.toLocaleString()} sats ({draft.feeRate} sat/vB)
              </span>
              <FiatDisplaySubtle sats={draft.fee} size="xs" className="ml-1" />
            </div>
          </div>

          {isAgentFundingDraft && (
            <div className="mt-2 text-sm text-sanctuary-600 dark:text-sanctuary-300">
              Agent signature: {agentSignatureText}
            </div>
          )}

          {/* Fee Warning */}
          {feeWarning && (
            <div className={`mt-2 p-2 rounded-lg border flex items-center gap-2 ${
              feeWarning.level === 'critical'
                ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
            }`}>
              <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${
                feeWarning.level === 'critical'
                  ? 'text-rose-500'
                  : 'text-amber-500'
              }`} />
              <span className={`text-sm ${
                feeWarning.level === 'critical'
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-amber-700 dark:text-amber-300'
              }`}>
                {feeWarning.message} ({feeWarning.percent.toFixed(1)}%)
              </span>
            </div>
          )}

          {draft.label && (
            <div className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
              Label: {draft.label}
            </div>
          )}

          {isAgentFundingDraft && (
            <div className="mt-2 p-2 rounded-lg border flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500 mt-0.5" />
              <span className="text-sm text-amber-700 dark:text-amber-300">
                Once funded, the agent can spend from the operational wallet without multisig approval.
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {expired ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-sanctuary-300 dark:bg-sanctuary-700 text-sanctuary-500 dark:text-sanctuary-400 cursor-not-allowed">
              <AlertCircle className="w-4 h-4" />
              Expired
            </span>
          ) : (
            <button
              onClick={() => onResume(draft)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 transition-colors"
            >
              <Play className="w-4 h-4" />
              Resume
            </button>
          )}

          <div className="flex gap-1">
            {/* Download/Upload PSBT only for single-sig - multisig has per-device buttons in ReviewStep */}
            {walletType !== WalletType.MULTI_SIG && (
              <>
                <button
                  onClick={() => onDownloadPsbt(draft)}
                  className="p-1.5 rounded-lg text-sanctuary-500 hover:text-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
                  title="Download PSBT"
                >
                  <Download className="w-4 h-4" />
                </button>

                {canEdit && (
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".psbt,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          onUploadPsbt(draft.id, file);
                        }
                        e.target.value = '';
                      }}
                    />
                    <span
                      className="inline-flex p-1.5 rounded-lg text-sanctuary-500 hover:text-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
                      title="Upload signed PSBT"
                    >
                      <Upload className="w-4 h-4" />
                    </span>
                  </label>
                )}
              </>
            )}

            {canEdit && (
              <>
                {deleteConfirm === draft.id ? (
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => onDelete(draft.id)}
                      className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => onSetDeleteConfirm(null)}
                      className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onSetDeleteConfirm(draft.id)}
                    className="p-1.5 rounded-lg text-sanctuary-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete draft"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expand/Collapse Toggle */}
      <button
        onClick={() => onToggleExpand(draft.id)}
        className="w-full mt-3 pt-3 border-t border-sanctuary-200 dark:border-sanctuary-700 flex items-center justify-center gap-1 text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="w-4 h-4" />
            Hide Transaction Flow
          </>
        ) : (
          <>
            <ChevronDown className="w-4 h-4" />
            Show Transaction Flow
          </>
        )}
      </button>

      {/* Transaction Flow Preview */}
      {isExpanded && (
        <div className="mt-4">
          <TransactionFlowPreview
            inputs={flowData.inputs}
            outputs={flowData.outputs}
            fee={flowData.fee}
            feeRate={flowData.feeRate}
            totalInput={flowData.totalInput}
            totalOutput={flowData.totalOutput}
            isEstimate={false}
          />
        </div>
      )}
    </div>
  );
};
