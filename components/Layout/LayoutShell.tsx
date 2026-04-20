import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Menu, X } from 'lucide-react';
import { SanctuaryLogo } from '../ui/CustomIcons';
import { AboutModal } from './AboutModal';
import type { LayoutController } from './useLayoutController';

interface LayoutShellProps {
  controller: LayoutController;
  sidebarContent: React.ReactNode;
  children: React.ReactNode;
}

interface MobileHeaderProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface MobileMenuOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  sidebarContent: React.ReactNode;
}

const DesktopSidebar: React.FC<{ sidebarContent: React.ReactNode }> = ({ sidebarContent }) => (
  <div className="hidden md:flex md:flex-shrink-0">
    <div className="flex flex-col w-64">
      <div className="flex flex-col h-0 flex-1 border-r border-sanctuary-200 dark:border-sanctuary-800 surface-elevated">
        {sidebarContent}
      </div>
    </div>
  </div>
);

const MobileHeader: React.FC<MobileHeaderProps> = ({ isOpen, onToggle }) => (
  <div className="md:hidden pl-1 pt-1 sm:pl-3 sm:pt-3 surface-elevated border-b border-sanctuary-200 dark:border-sanctuary-800 flex justify-between items-center px-4 h-16">
    <div className="flex items-center">
      <SanctuaryLogo className="h-6 w-6 text-primary-700 dark:text-primary-500 mr-2" />
      <span className="text-lg font-semibold tracking-tight text-sanctuary-800 dark:text-sanctuary-200">Sanctuary</span>
    </div>
    <button
      onClick={onToggle}
      className="-ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 transition-colors"
    >
      <span className="sr-only">Open sidebar</span>
      {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
    </button>
  </div>
);

const MobileMenuOverlay: React.FC<MobileMenuOverlayProps> = ({
  isOpen,
  onClose,
  sidebarContent,
}) => {
  if (!isOpen) return null;

  return (
    <div className="md:hidden fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative flex-1 flex flex-col max-w-xs w-full surface-elevated">
        {sidebarContent}
      </div>
    </div>
  );
};

const DefaultPasswordWarning: React.FC<{ show: boolean }> = ({ show }) => {
  if (!show) return null;

  return (
    <div className="bg-amber-500 dark:bg-amber-600">
      <div className="max-w-7xl mx-auto py-2 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between flex-wrap">
          <div className="flex-1 flex items-center">
            <span className="flex p-1 rounded-lg bg-amber-600 dark:bg-amber-700">
              <AlertTriangle className="h-5 w-5 text-white" />
            </span>
            <p className="ml-3 font-medium text-white text-sm">
              <span>Security Warning: You are using the default password.</span>
              <Link
                to="/account"
                className="ml-2 underline hover:text-amber-100 font-semibold"
              >
                Change it now →
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export const LayoutShell: React.FC<LayoutShellProps> = ({
  controller,
  sidebarContent,
  children,
}) => (
  <div className="flex h-screen overflow-hidden text-sanctuary-900 dark:text-sanctuary-100 transition-colors duration-500 noise-overlay">
    <DesktopSidebar sidebarContent={sidebarContent} />

    <div className="flex flex-col flex-1 w-0 overflow-hidden bg-transparent">
      <MobileHeader
        isOpen={controller.isMobileMenuOpen}
        onToggle={() => controller.setIsMobileMenuOpen(!controller.isMobileMenuOpen)}
      />
      <MobileMenuOverlay
        isOpen={controller.isMobileMenuOpen}
        onClose={() => controller.setIsMobileMenuOpen(false)}
        sidebarContent={sidebarContent}
      />

      <main className="flex-1 relative overflow-y-auto focus:outline-none content-atmosphere">
        <DefaultPasswordWarning
          show={!!controller.user?.isAdmin && !!controller.user?.usingDefaultPassword}
        />
        <div className="py-8 px-4 sm:px-6 md:px-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>

    <AboutModal
      show={controller.showVersionModal}
      onClose={() => controller.setShowVersionModal(false)}
      versionInfo={controller.versionInfo}
      versionLoading={controller.versionLoading}
      copiedAddress={controller.copiedAddress}
      onCopyAddress={controller.copyToClipboard}
    />
  </div>
);
