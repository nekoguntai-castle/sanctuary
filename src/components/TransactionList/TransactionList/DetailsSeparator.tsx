export function DetailsSeparator() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <div className="w-full border-t border-sanctuary-200 dark:border-sanctuary-800"></div>
      </div>
      <div className="relative flex justify-center">
        <span className="surface-elevated px-3 text-sm text-sanctuary-500 uppercase tracking-wide">Details</span>
      </div>
    </div>
  );
}
