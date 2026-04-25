import type {
  ConsolidationSuggestionNotifyJobData,
  NotifyJobResult,
} from './types';
import { notificationChannelRegistry } from '../../services/notifications/channels';
import type { ConsolidationSuggestionNotification } from '../../services/notifications/channels';
import { notificationJobResultsTotal } from '../../observability/metrics/infrastructureMetrics';

export type NotificationJobMetricResult =
  | 'success'
  | 'no_recipients'
  | 'skipped'
  | 'no_channels'
  | 'channel_error'
  | 'partial_channel_error'
  | 'exception';

export type NotificationResultLike = {
  success: boolean;
  channelId?: string;
  usersNotified: number;
  errors?: string[];
};

export class NotificationJobDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationJobDispatchError';
  }
}

export function summarizeNotificationResults(
  results: NotificationResultLike[],
  noChannelsError: string
): NotifyJobResult {
  if (results.length === 0) {
    return {
      success: false,
      channelsNotified: 0,
      errors: [noChannelsError],
    };
  }

  let channelsNotified = 0;
  const errors: string[] = [];

  for (const result of results) {
    if (result.success) {
      channelsNotified += result.usersNotified;
      continue;
    }

    const resultErrors = result.errors?.filter(Boolean) ?? [];
    if (resultErrors.length > 0) {
      errors.push(...resultErrors);
    } else {
      errors.push(`${result.channelId ?? 'unknown'} notification failed without error details`);
    }
  }

  return {
    success: errors.length === 0,
    channelsNotified,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export function recordNotificationJobResult(
  jobName: string,
  result: NotificationJobMetricResult
): void {
  notificationJobResultsTotal.inc({ job_name: jobName, result });
}

export function recordNotificationSummary(
  jobName: string,
  summary: NotifyJobResult,
  noChannelsError: string
): NotificationJobMetricResult {
  const result = getSummaryMetricResult(summary, noChannelsError);
  recordNotificationJobResult(jobName, result);
  return result;
}

export function shouldFailBullMqNotificationJob(summary: NotifyJobResult): boolean {
  return !summary.success && summary.channelsNotified === 0;
}

export function createNotificationJobFailure(
  summary: NotifyJobResult,
  fallbackMessage: string
): Error {
  return new NotificationJobDispatchError(summary.errors?.join('; ') || fallbackMessage);
}

export function buildConsolidationSuggestion(
  data: ConsolidationSuggestionNotifyJobData
): ConsolidationSuggestionNotification {
  return {
    walletId: data.walletId,
    walletName: data.walletName,
    feeRate: data.feeRate,
    utxoHealth: {
      totalUtxos: data.utxoHealth.totalUtxos,
      dustCount: data.utxoHealth.dustCount,
      dustValue: BigInt(data.utxoHealth.dustValue),
      totalValue: BigInt(data.utxoHealth.totalValue),
    },
    estimatedSavings: data.estimatedSavings,
    reason: data.reason,
  };
}

export function getEnabledConsolidationChannelIds(
  data: ConsolidationSuggestionNotifyJobData
): string[] {
  const channelIds: string[] = [];
  if (data.notifyTelegram) channelIds.push('telegram');
  if (data.notifyPush) channelIds.push('push');
  return channelIds;
}

export function getConsolidationCapableChannelIds(): string[] {
  return notificationChannelRegistry.getConsolidationSuggestionCapable()
    .map(channel => channel.id);
}

export function getSupportedConsolidationChannelIds(
  channelIds: string[],
  capableChannelIds: string[]
): string[] {
  const capableChannelIdSet = new Set(capableChannelIds);
  return channelIds.filter(channelId => capableChannelIdSet.has(channelId));
}

function getSummaryMetricResult(
  summary: NotifyJobResult,
  noChannelsError: string
): NotificationJobMetricResult {
  if (summary.success) {
    return summary.channelsNotified > 0 ? 'success' : 'no_recipients';
  }

  if (summary.errors?.includes(noChannelsError)) {
    return 'no_channels';
  }

  return summary.channelsNotified > 0 ? 'partial_channel_error' : 'channel_error';
}
