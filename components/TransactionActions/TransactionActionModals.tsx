import { CPFPModal } from './CPFPModal';
import { RBFModal } from './RBFModal';
import type { TransactionActionHandlers, TransactionActionState } from './types';

export function TransactionActionModals({
  handlers,
  state,
}: {
  handlers: TransactionActionHandlers;
  state: TransactionActionState;
}) {
  return (
    <>
      <RBFModal handlers={handlers} state={state} />
      <CPFPModal handlers={handlers} state={state} />
    </>
  );
}
