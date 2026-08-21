export function assertArchitectureExceptionBudget(exceptionCount, maximumCount) {
  if (exceptionCount <= maximumCount) {
    return;
  }

  throw new Error(
    `architecture-boundaries: exception budget exceeded (${exceptionCount} > ${maximumCount})`
  );
}
