import { useQueryClient } from '@tanstack/react-query';
import { render,screen } from '@testing-library/react';
import React from 'react';
import { describe,expect,it } from 'vitest';
import { QueryProvider,getQueryClient } from '../../src/providers/QueryProvider';

const ClientProbe: React.FC = () => {
  const client = useQueryClient();
  return <div data-testid="client-match">{String(client === getQueryClient())}</div>;
};

describe('QueryProvider', () => {
  it('provides the shared query client instance to children', () => {
    render(
      <QueryProvider>
        <ClientProbe />
      </QueryProvider>
    );

    expect(screen.getByTestId('client-match')).toHaveTextContent('true');
  });
});
