import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256,
  WEBHOOK_AUTH_TYPE_HMAC_SHA256,
  WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
  WEBHOOK_VALUATION_MODE_OPTIONAL,
} from '../../../../shared/constants/webhooks';
import { WalletWebhookForm } from '../../../../components/WalletDetail/webhooks/WalletWebhookForm';
import {
  DEFAULT_HMAC_CONFIG,
  defaultForm,
  type WebhookFormState,
} from '../../../../components/WalletDetail/webhooks/model';

describe('WalletWebhookForm', () => {
  it('emits changes for basic webhook fields and create actions', () => {
    const { onCreate, onFormChange } = renderForm(undefined, { canSave: true });

    fireEvent.change(screen.getByPlaceholderText('Endpoint name'), {
      target: { value: 'External receiver' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'External receiver',
    }));

    fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
      target: { value: 'https://hooks.example.com/wallet' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      url: 'https://hooks.example.com/wallet',
    }));

    fireEvent.change(screen.getByPlaceholderText('Event types'), {
      target: { value: 'wallet.transaction.received' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      eventTypes: 'wallet.transaction.received',
    }));

    fireEvent.change(screen.getByLabelText('Payload'), {
      target: { value: WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      payloadProfile: WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
    }));

    fireEvent.change(screen.getByLabelText('Auth'), {
      target: { value: WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256 },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      authType: WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256,
      headerConfigJson: DEFAULT_HMAC_CONFIG,
    }));

    fireEvent.change(screen.getByLabelText('Secret'), {
      target: { value: 'shared-secret' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      secret: 'shared-secret',
    }));

    fireEvent.click(screen.getByLabelText('Alert on max retries'));
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      failureNotificationEnabled: false,
    }));

    fireEvent.change(screen.getByLabelText('Max retries'), {
      target: { value: '26' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      maxAttempts: 25,
    }));

    fireEvent.click(screen.getByText('Advanced'));
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      advancedOpen: true,
    }));

    fireEvent.click(screen.getByText('Add webhook'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('preserves existing header config when configured HMAC is selected', () => {
    const { onFormChange } = renderForm({ headerConfigJson: '{"existing":true}' });

    fireEvent.change(screen.getByLabelText('Auth'), {
      target: { value: WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256 },
    });

    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      authType: WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256,
      headerConfigJson: '{"existing":true}',
    }));
  });

  it('shows secret placeholder and saving state for authenticated endpoints', () => {
    renderForm({ authType: WEBHOOK_AUTH_TYPE_HMAC_SHA256 }, { canSave: true, saving: true });

    expect(screen.getByPlaceholderText('Signing secret')).toBeInTheDocument();
    expect(screen.getByText('Saving...')).toBeDisabled();
  });

  it('renders advanced fields and emits advanced config updates', () => {
    const { onFormChange } = renderForm({
      advancedOpen: true,
      payloadProfile: WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
    });

    fireEvent.change(screen.getByLabelText('Valuation'), {
      target: { value: WEBHOOK_VALUATION_MODE_OPTIONAL },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      valuationMode: WEBHOOK_VALUATION_MODE_OPTIONAL,
    }));

    fireEvent.change(screen.getByLabelText('Currency'), {
      target: { value: 'eur' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      valuationCurrency: 'EUR',
    }));

    fireEvent.change(screen.getByLabelText('Backoff'), {
      target: { value: '1.5' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      retryBackoffMultiplier: 1.5,
    }));

    fireEvent.change(screen.getByLabelText('Initial retry delay ms'), {
      target: { value: '0' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      retryInitialDelayMs: 1,
    }));

    fireEvent.change(screen.getByLabelText('Max retry delay ms'), {
      target: { value: '2500' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      retryMaxDelayMs: 2500,
    }));

    fireEvent.change(screen.getByLabelText('Filters JSON'), {
      target: { value: '{"direction":"received"}' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      filtersJson: '{"direction":"received"}',
    }));

    fireEvent.change(screen.getByLabelText('Body mapping JSON'), {
      target: { value: '{"amount":{"path":"transaction.amountSats"}}' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      bodyMappingJson: '{"amount":{"path":"transaction.amountSats"}}',
    }));

    fireEvent.change(screen.getByLabelText('Headers and HMAC JSON'), {
      target: { value: '{"headers":{"x-static":"yes"}}' },
    });
    expect(onFormChange).toHaveBeenLastCalledWith(expect.objectContaining({
      headerConfigJson: '{"headers":{"x-static":"yes"}}',
    }));
  });
});

function renderForm(
  overrides: Partial<WebhookFormState> = {},
  options: { canSave?: boolean; saving?: boolean } = {},
) {
  const onCreate = vi.fn();
  const onFormChange = vi.fn();
  const form = { ...defaultForm(), ...overrides };
  render(
    <WalletWebhookForm
      form={form}
      saving={options.saving ?? false}
      canSave={options.canSave ?? false}
      onFormChange={onFormChange}
      onCreate={onCreate}
    />,
  );
  return { onCreate, onFormChange };
}
