interface SigningFlowHeaderProps {
  requiredSignatures: number;
  signedCount: number;
}

export function SigningFlowHeader({
  requiredSignatures,
  signedCount,
}: SigningFlowHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
        Signatures Required
      </h3>
      <span className="text-sm text-sanctuary-500">
        {signedCount} of {requiredSignatures}
      </span>
    </div>
  );
}
