import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card } from '../ui/Card';

/**
 * Shown when the wallet request failed and we therefore have no list — not when
 * the list came back empty.
 *
 * The distinction matters more here than almost anywhere else in the app. An
 * empty list renders `WelcomeState`, which invites the reader to create their
 * first wallet. Shown to someone who already has funded wallets, that does not
 * read as "we could not load this"; it reads as "your wallets are gone", which
 * is the single most alarming thing a self-custody wallet can say by accident.
 *
 * So this states the failure plainly. Note what it does NOT say: a failed read
 * is evidence about our connection, not about the server's state. A 401 after a
 * permission change, or a 5xx mid-restore, are cases where the wallets may be
 * exactly what changed — so reassurance is scoped to this request, which wrote
 * nothing, rather than to balances we cannot see.
 */
export const WalletsUnavailable: React.FC<{ className?: string }> = ({ className = '' }) => (
  // `role="status"` announces the swap out of the welcome state without the
  // interruption `role="alert"` would cause on first paint.
  <Card padding="xl" role="status" className={`${className} text-center`} data-testid="wallets-unavailable">
    <AlertTriangle
      className="h-8 w-8 mx-auto text-warning-600 mb-4"
      aria-hidden="true"
    />
    <h2 className="text-lg text-sanctuary-800 dark:text-sanctuary-200 mb-2">
      Wallets unavailable
    </h2>
    <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 max-w-md mx-auto">
      We could not reach the server to load your wallets, so this page cannot
      show them. This was a read that failed — nothing was created, deleted, or
      sent. Check that the server is running, then try again.
    </p>
  </Card>
);
