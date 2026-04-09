import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { SanctuaryLogo } from '../ui/CustomIcons';

export const WelcomeState: React.FC = () => (
  <div className="animate-fade-in-up-5 surface-elevated rounded-xl p-12 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 text-center relative overflow-hidden">
    {/* Ambient glow */}
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-primary-100/40 dark:bg-primary-900/15 blur-3xl pointer-events-none" />
    <div className="relative z-10">
      <SanctuaryLogo className="h-16 w-16 mx-auto text-primary-500 dark:text-primary-400 mb-6 logo-breathe" />
      <h2 className="text-2xl text-sanctuary-800 dark:text-sanctuary-200 mb-2">
        Welcome to Sanctuary
      </h2>
      <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 max-w-md mx-auto mb-6">
        Your self-hosted Bitcoin wallet coordinator. Create or import a wallet to begin managing your Bitcoin with full sovereignty.
      </p>
      <Link to="/wallets/create">
        <Button variant="primary" size="lg">
          Create Your First Wallet
        </Button>
      </Link>
    </div>
  </div>
);
