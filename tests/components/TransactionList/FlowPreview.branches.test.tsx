import { render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { FlowPreview } from '../../../src/components/TransactionList/FlowPreview';

const flowPreviewPropsSpy = vi.hoisted(() => vi.fn());

vi.mock('../../../src/components/TransactionFlowPreview', () => ({
  TransactionFlowPreview: (props: any) => {
    flowPreviewPropsSpy(props);
    return <div data-testid="tx-flow-preview" />;
  },
}));

describe('FlowPreview branch coverage', () => {
  it('covers outputs/fee fallbacks when full details omit optional fields', () => {
    render(
      <FlowPreview
        selectedTx={{ id: 'tx-1', fee: undefined } as any}
        loadingDetails={false}
        fullTxDetails={{
          id: 'tx-1',
          inputs: [{ txid: 'in-1', vout: 0, address: 'bc1qin', amount: 1111 }],
          outputs: undefined,
        } as any}
      />,
    );

    expect(screen.getByTestId('tx-flow-preview')).toBeInTheDocument();

    const call = flowPreviewPropsSpy.mock.calls.at(-1)?.[0];
    expect(call.outputs).toEqual([]);
    expect(call.fee).toBe(0);
    expect(call.totalOutput).toBe(0);
  });

  it('covers unknown output labels and non-fallback fee/output branches', () => {
    render(
      <FlowPreview
        selectedTx={{ id: 'tx-2', fee: 250 } as any}
        loadingDetails={false}
        fullTxDetails={{
          id: 'tx-2',
          inputs: [{ txid: 'in-2', vout: 1, address: 'bc1qin2', amount: 2000 }],
          outputs: [
            { address: 'bc1qout1', amount: 1500, outputType: 'unknown' },
            { address: 'bc1qchange', amount: 250, outputType: 'change' },
          ],
        } as any}
      />,
    );

    const call = flowPreviewPropsSpy.mock.calls.at(-1)?.[0];
    expect(call.fee).toBe(250);
    expect(call.outputs[0]).toMatchObject({
      address: 'bc1qout1',
      amount: 1500,
      isChange: false,
      label: undefined,
    });
    expect(call.outputs[1]).toMatchObject({
      address: 'bc1qchange',
      amount: 250,
      isChange: true,
      label: 'change',
    });
    expect(call.totalOutput).toBe(1750);
  });
});
