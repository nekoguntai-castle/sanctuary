import { truncateAddress } from '../utils/formatters';
import type { FlowInput, FlowOutput } from './TransactionFlowPreview';

const INPUT_COLOR = '#1a9436';
const OUTPUT_COLOR = '#9c4dc4';
const CHANGE_COLOR = '#6c757d';
const FEE_COLOR = '#dc3545';

type SatsFormatter = (sats: number) => string;
type FiatFormatter = (sats: number) => string | null;

interface FlowFiatDisplayProps {
  sats: number;
  formatFiat: FiatFormatter;
}

interface FlowAmountTextProps extends FlowFiatDisplayProps {
  amountText: string;
  isEstimate: boolean;
}

interface FlowRowSharedProps {
  barHeight: number;
  format: SatsFormatter;
  formatFiat: FiatFormatter;
  isEstimate: boolean;
}

interface FlowInputRowProps extends FlowRowSharedProps {
  input: FlowInput;
}

interface FlowOutputRowProps extends FlowRowSharedProps {
  output: FlowOutput;
  index: number;
}

interface FlowFeeRowProps {
  fee: number;
  feeRate: number;
  barHeight: number;
  isEstimate: boolean;
}

interface FlowColumnProps {
  inputs?: FlowInput[];
  outputs?: FlowOutput[];
  fee?: number;
  feeRate?: number;
  barHeight: (amount: number) => number;
  format: SatsFormatter;
  formatFiat: FiatFormatter;
  isEstimate: boolean;
}

interface PreviewFooterProps {
  totalInput: number;
  totalOutput: number;
  format: SatsFormatter;
  formatFiat: FiatFormatter;
  isEstimate: boolean;
}

interface PreviewHeaderProps {
  isEstimate: boolean;
  inputCount: number;
  outputCount: number;
}

function FlowFiatDisplay({ sats, formatFiat }: FlowFiatDisplayProps) {
  const fiatValue = formatFiat(sats);

  if (!fiatValue) {
    return null;
  }

  return (
    <span className="text-[9px] text-white/60 ml-1">
      {fiatValue}
    </span>
  );
}

function FlowAmountText({ amountText, sats, formatFiat, isEstimate }: FlowAmountTextProps) {
  return (
    <span className="text-white text-[11px] font-semibold whitespace-nowrap drop-shadow-sm flex items-center">
      {isEstimate && '~'}{amountText}
      <FlowFiatDisplay sats={sats} formatFiat={formatFiat} />
    </span>
  );
}

export function getMaxFlowAmount(inputs: FlowInput[], outputs: FlowOutput[], fee: number): number {
  const inputAmounts = inputs.map((input) => input.amount);
  const outputAmounts = outputs.map((output) => output.amount);
  return Math.max(...inputAmounts, ...outputAmounts, fee, 1);
}

export function getBarHeight(amount: number, maxAmount: number): number {
  const minHeight = 28;
  const maxHeight = 48;
  const proportion = amount / maxAmount;
  return Math.max(minHeight, proportion * maxHeight);
}

function getOutputGradient(output: FlowOutput): string {
  const endColor = output.isChange ? '#4b5563' : '#7c3aed';
  const startColor = output.isChange ? CHANGE_COLOR : OUTPUT_COLOR;
  return `linear-gradient(135deg, ${startColor} 0%, ${endColor} 100%)`;
}

export function PreviewHeader({ isEstimate, inputCount, outputCount }: PreviewHeaderProps) {
  return (
    <div className="px-3 py-2 border-b border-[#2d2f43]/50 flex items-center justify-between">
      <span className="text-xs font-bold text-white">
        Preview
        {isEstimate && (
          <span className="ml-1 text-[10px] font-medium text-gray-400">(est.)</span>
        )}
      </span>
      <div className="flex items-center gap-2 text-[10px] font-medium text-gray-400">
        <span>{inputCount} in</span>
        <span>→</span>
        <span>{outputCount} out</span>
      </div>
    </div>
  );
}

function FlowInputRow({ input, barHeight, format, formatFiat, isEstimate }: FlowInputRowProps) {
  return (
    <div
      className="flex items-center rounded-lg overflow-hidden transition-all duration-200 hover:scale-[1.01]"
      style={{ height: barHeight }}
    >
      <div
        className="h-full flex items-center justify-end px-2 min-w-[60px] rounded-l-xl flex-shrink-0"
        style={{ background: `linear-gradient(135deg, ${INPUT_COLOR} 0%, #15803d 100%)` }}
      >
        <FlowAmountText
          amountText={format(input.amount)}
          sats={input.amount}
          formatFiat={formatFiat}
          isEstimate={isEstimate}
        />
      </div>
      <div className="flex-1 min-w-0 px-2 py-1 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-r-xl overflow-hidden">
        <span className="font-mono text-xs text-white/90 truncate flex-shrink min-w-0">
          {truncateAddress(input.address, 8, 8)}
        </span>
        {input.label && (
          <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-cyan-500 text-white flex-shrink-0 whitespace-nowrap">
            {input.label}
          </span>
        )}
      </div>
    </div>
  );
}

function FlowOutputBadges({ output }: { output: FlowOutput }) {
  return (
    <>
      {output.isChange && (
        <span className="ml-1 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-amber-500/30 text-amber-300 flex-shrink-0 whitespace-nowrap">
          change
        </span>
      )}
      {output.label && (
        <span className="ml-1 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-cyan-500 text-white flex-shrink-0 whitespace-nowrap">
          {output.label}
        </span>
      )}
    </>
  );
}

function FlowOutputRow({
  output,
  index,
  barHeight,
  format,
  formatFiat,
  isEstimate,
}: FlowOutputRowProps) {
  return (
    <div
      key={`${output.address}-${index}`}
      className="flex items-center rounded-lg overflow-hidden transition-all duration-200 hover:scale-[1.01]"
      style={{ height: barHeight }}
    >
      <div className="flex-1 min-w-0 px-2 py-1 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-l-xl overflow-hidden">
        <span className="font-mono text-xs text-white/90 truncate flex-shrink min-w-0">
          {truncateAddress(output.address, 8, 8)}
        </span>
        <FlowOutputBadges output={output} />
      </div>
      <div
        className="h-full flex items-center justify-start px-2 min-w-[60px] rounded-r-xl flex-shrink-0"
        style={{ background: getOutputGradient(output) }}
      >
        <FlowAmountText
          amountText={format(output.amount)}
          sats={output.amount}
          formatFiat={formatFiat}
          isEstimate={isEstimate}
        />
      </div>
    </div>
  );
}

function EmptyFlowColumn({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center rounded-xl bg-[#2d2f43]/50 text-white/60 text-sm font-medium">
      {label}
    </div>
  );
}

export function InputsColumn({
  inputs = [],
  format,
  formatFiat,
  isEstimate,
  barHeight,
}: FlowColumnProps) {
  return (
    <div className="flex-1 flex flex-col gap-2">
      {inputs.map((input) => (
        <FlowInputRow
          key={`${input.txid}:${input.vout}`}
          input={input}
          barHeight={barHeight(input.amount)}
          format={format}
          formatFiat={formatFiat}
          isEstimate={isEstimate}
        />
      ))}
      {inputs.length === 0 && <EmptyFlowColumn label="No inputs" />}
    </div>
  );
}

export function FlowConnector() {
  return (
    <div className="w-8 flex flex-col items-center justify-center relative">
      <div className="absolute top-1 bottom-1 w-0.5 rounded-full bg-gradient-to-b from-[#1a9436] via-[#4e4e7a] to-[#9c4dc4]" />
      <div className="relative z-10 w-5 h-5 rounded-full bg-[#4e4e7a] flex items-center justify-center">
        <span className="text-white text-xs">→</span>
      </div>
    </div>
  );
}

function FlowFeeRow({ fee, feeRate, barHeight, isEstimate }: FlowFeeRowProps) {
  return (
    <div
      className="flex items-center rounded-lg overflow-hidden transition-all duration-200"
      style={{ height: Math.max(24, barHeight * 0.5) }}
    >
      <div className="flex-1 px-2 py-1 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-l-xl">
        <span className="text-[10px] font-medium text-white/80">
          Fee ({feeRate} sat/vB)
        </span>
      </div>
      <div
        className="h-full flex items-center justify-start px-2 min-w-[60px] rounded-r-xl flex-shrink-0"
        style={{ background: `linear-gradient(135deg, ${FEE_COLOR} 0%, #b91c1c 100%)` }}
      >
        <span className="text-white text-[11px] font-semibold whitespace-nowrap drop-shadow-sm">
          {isEstimate && '~'}{fee.toLocaleString()} sats
        </span>
      </div>
    </div>
  );
}

export function OutputsColumn({
  outputs = [],
  fee = 0,
  feeRate = 0,
  format,
  formatFiat,
  isEstimate,
  barHeight,
}: FlowColumnProps) {
  return (
    <div className="flex-1 flex flex-col gap-2">
      {outputs.map((output, index) => (
        <FlowOutputRow
          key={`${output.address}-${index}`}
          output={output}
          index={index}
          barHeight={barHeight(output.amount)}
          format={format}
          formatFiat={formatFiat}
          isEstimate={isEstimate}
        />
      ))}
      {fee > 0 && (
        <FlowFeeRow
          fee={fee}
          feeRate={feeRate}
          barHeight={barHeight(fee)}
          isEstimate={isEstimate}
        />
      )}
      {outputs.length === 0 && fee === 0 && <EmptyFlowColumn label="No outputs" />}
    </div>
  );
}

export function PreviewFooter({
  totalInput,
  totalOutput,
  format,
  formatFiat,
  isEstimate,
}: PreviewFooterProps) {
  return (
    <div className="px-3 py-2 border-t border-[#2d2f43] flex items-center justify-between text-xs">
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: INPUT_COLOR }} />
        <span className="text-white/70">In:</span>
        <span className="text-white font-semibold">
          {isEstimate && '~'}{format(totalInput)}
        </span>
        <FlowFiatDisplay sats={totalInput} formatFiat={formatFiat} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-white/70">Out:</span>
        <span className="text-white font-semibold">
          {isEstimate && '~'}{format(totalOutput)}
        </span>
        <FlowFiatDisplay sats={totalOutput} formatFiat={formatFiat} />
        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: OUTPUT_COLOR }} />
      </div>
    </div>
  );
}
