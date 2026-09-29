import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { useDeviceSave } from '../../src/hooks/useDeviceSave';
import { deviceKeys } from '../../src/hooks/queries/deviceKeys';

const { save, refresh } = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock('../../src/api/devices', () => ({ createDeviceWithConflictHandling: save, mergeDeviceAccounts: vi.fn() }));
vi.mock('../../src/contexts/SidebarContext', () => ({ useSidebar: () => ({ refreshSidebar: refresh }) }));

it('refreshes active device list and detail observers after an accepted write', async () => {
  let version = 0;
  save.mockImplementation(async () => {
    version = 1;
    return { status: 'created', device: { id: 'new-device' } };
  });
  const onSuccess = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function ActiveDeviceQueries() {
    const list = useQuery({ queryKey: deviceKeys.lists(), queryFn: async () => version });
    const detail = useQuery({ queryKey: deviceKeys.detail('existing'), queryFn: async () => version });
    const deviceSave = useDeviceSave({ onSuccess });
    return <>
      <output data-testid="list-version">{list.data}</output>
      <output data-testid="detail-version">{detail.data}</output>
      <button onClick={() => { void deviceSave.saveDevice({ type: 'ledger', label: 'Ledger', fingerprint: 'abcdef12' }); }}>Save</button>
    </>;
  }
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><MemoryRouter><ActiveDeviceQueries /></MemoryRouter></QueryClientProvider>);
  await waitFor(() => {
    expect(screen.getByTestId('list-version')).toHaveTextContent('0');
    expect(screen.getByTestId('detail-version')).toHaveTextContent('0');
  });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(screen.getByTestId('list-version')).toHaveTextContent('1');
    expect(screen.getByTestId('detail-version')).toHaveTextContent('1');
  });
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith('new-device');
});
