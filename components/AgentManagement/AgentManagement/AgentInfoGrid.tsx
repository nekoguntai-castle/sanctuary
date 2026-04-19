import type { InfoBlockViewModel } from './agentRowModel';

export function AgentInfoGrid({ blocks }: { blocks: InfoBlockViewModel[] }) {
  return (
    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
      {blocks.map(block => (
        <InfoBlock key={block.label} {...block} />
      ))}
    </div>
  );
}

function InfoBlock({ label, value, helper }: InfoBlockViewModel) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-sanctuary-400">{label}</div>
      <div className="truncate text-sanctuary-800 dark:text-sanctuary-200">{value}</div>
      {helper && <div className="truncate text-xs text-sanctuary-500 dark:text-sanctuary-400">{helper}</div>}
    </div>
  );
}
