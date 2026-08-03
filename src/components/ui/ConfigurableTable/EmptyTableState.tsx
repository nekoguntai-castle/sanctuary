interface EmptyTableStateProps {
  message: string;
}

export function EmptyTableState({ message }: EmptyTableStateProps) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-8 text-center text-sanctuary-400">
      {message}
    </div>
  );
}
