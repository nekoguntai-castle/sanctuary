import { render,screen } from '@testing-library/react';
import { describe,expect,it } from 'vitest';
import { StatCards } from '../../../src/components/AuditLogs/StatCards';

describe('AuditLogs StatCards branch coverage', () => {
  it('renders known category color mapping and formatted counts', () => {
    const { container } = render(
      <StatCards
        stats={{
          totalEvents: 1200,
          failedEvents: 23,
          byCategory: {
            auth: 10,
          },
          byAction: {},
        }}
      />
    );

    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText('(10)')).toBeInTheDocument();

    const authLabel = screen.getByText('auth');
    expect(authLabel.parentElement).toHaveClass('bg-blue-100');
    expect(container.querySelector('.text-warning-500')).toBeInTheDocument();
  });

  it('falls back to system category color for unknown category keys', () => {
    render(
      <StatCards
        stats={{
          totalEvents: 1,
          failedEvents: 0,
          byCategory: {
            unknown: 1,
          },
          byAction: {},
        }}
      />
    );

    const unknownLabel = screen.getByText('unknown');
    expect(unknownLabel.parentElement).toHaveClass('bg-gray-100');
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });
});
