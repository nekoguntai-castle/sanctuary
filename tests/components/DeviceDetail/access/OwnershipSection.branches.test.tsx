import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OwnershipSection } from '../../../../components/DeviceDetail/access/OwnershipSection';

describe('OwnershipSection branch coverage', () => {
  it('uses shared owner info when present and shows transfer action for owners', () => {
    const onTransfer = vi.fn();

    render(
      <OwnershipSection
        deviceShareInfo={{
          users: [
            { userId: 'u1', username: 'alice', role: 'owner' },
            { userId: 'u2', username: 'bob', role: 'viewer' },
          ],
        } as any}
        username="fallbackUser"
        isOwner={true}
        onTransfer={onTransfer}
      />
    );

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /transfer/i }));
    expect(onTransfer).toHaveBeenCalledTimes(1);
  });

  it('falls back to local defaults and hides transfer when not owner', () => {
    render(
      <OwnershipSection
        deviceShareInfo={null}
        username={undefined}
        isOwner={false}
        onTransfer={vi.fn()}
      />
    );

    expect(screen.getByText('U')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transfer/i })).not.toBeInTheDocument();
  });
});
