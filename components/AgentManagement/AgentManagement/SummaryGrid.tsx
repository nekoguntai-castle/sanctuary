import type { SummaryItem } from './agentRowModel';

export function SummaryGrid({ items, className }: { items: SummaryItem[]; className: string }) {
  return (
    <div className={className}>
      {items.map(item => (
        <SummaryText key={item.label} item={item} />
      ))}
    </div>
  );
}

function SummaryText({ item }: { item: SummaryItem }) {
  if (!item.value) {
    return <span>{item.label}</span>;
  }

  return <span>{item.label}: {item.value}</span>;
}
