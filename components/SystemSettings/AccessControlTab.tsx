import React, { useState, useEffect, useRef } from 'react';
import { Shield, UserPlus, Check, AlertCircle } from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';

function useSaveSuccessState(durationMs = 3000) {
  const [saveSuccess, setSaveSuccess] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const showSaveSuccess = () => {
    setSaveSuccess(true);
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => setSaveSuccess(false), durationMs);
  };

  return { saveSuccess, showSaveSuccess };
}

function AccessControlHeader() {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-3">
        <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
          <Shield className="w-5 h-5" />
        </div>
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Access Control</h3>
      </div>
    </div>
  );
}

interface RegistrationToggleButtonProps {
  disabled: boolean;
  onClick: () => void;
  registrationEnabled: boolean;
}

function RegistrationToggleButton({
  disabled,
  onClick,
  registrationEnabled,
}: RegistrationToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
        registrationEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`inline-block h-6 w-6 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
          registrationEnabled ? 'translate-x-7' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

interface RegistrationControlRowProps {
  isSaving: boolean;
  onToggleRegistration: () => void;
  registrationEnabled: boolean;
}

function RegistrationControlRow({
  isSaving,
  onToggleRegistration,
  registrationEnabled,
}: RegistrationControlRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-start space-x-4">
        <div className="p-2 surface-secondary rounded-lg">
          <UserPlus className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
        </div>
        <div className="space-y-1">
          <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Public Registration
          </label>
          <p className="text-sm text-sanctuary-500 max-w-md">
            Allow new users to create accounts on their own. When disabled, only administrators can create new user accounts.
          </p>
        </div>
      </div>
      <RegistrationToggleButton
        disabled={isSaving}
        onClick={onToggleRegistration}
        registrationEnabled={registrationEnabled}
      />
    </div>
  );
}

function RegistrationStatusMessage({ registrationEnabled }: { registrationEnabled: boolean }) {
  if (registrationEnabled) {
    return (
      <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
        <Check className="w-4 h-4" />
        <span className="text-sm">Public registration is enabled. Anyone can create an account.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-2 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400">
      <AlertCircle className="w-4 h-4" />
      <span className="text-sm">Public registration is disabled. Only admins can create accounts.</span>
    </div>
  );
}

function AccessControlSaveFeedback({
  saveError,
  saveSuccess,
}: {
  saveError: string | null;
  saveSuccess: boolean;
}) {
  return (
    <>
      {saveSuccess && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
          <Check className="w-4 h-4" />
          <span className="text-sm">Settings saved successfully</span>
        </div>
      )}

      {saveError && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{saveError}</span>
        </div>
      )}
    </>
  );
}

function UserManagementInfoBox() {
  return (
    <div className="surface-secondary rounded-lg p-4 border border-sanctuary-200 dark:border-sanctuary-700">
      <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
        About User Management
      </h4>
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
        When public registration is disabled, you can still create new users from the{' '}
        <span className="font-medium text-primary-600 dark:text-primary-400">Users & Groups</span>{' '}
        administration page. This is useful for private deployments where you want to control who has access.
      </p>
    </div>
  );
}

export const AccessControlTab: React.FC = () => {
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const { saveSuccess, showSaveSuccess } = useSaveSuccessState();

  // Loading states using hook
  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: isSaving, error: saveError, execute: runSave } = useLoadingState();

  useEffect(() => {
    void runLoad(async () => {
      const settings = await adminApi.getSystemSettings();
      setRegistrationEnabled(settings.registrationEnabled);
    });
  }, []);

  const handleToggleRegistration = async () => {
    const newValue = !registrationEnabled;

    const result = await runSave(async () => {
      await adminApi.updateSystemSettings({ registrationEnabled: newValue });
    });

    if (result !== null) {
      setRegistrationEnabled(newValue);
      showSaveSuccess();
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading access control settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <AccessControlHeader />

        <div className="p-6 space-y-6">
          <RegistrationControlRow
            isSaving={isSaving}
            onToggleRegistration={handleToggleRegistration}
            registrationEnabled={registrationEnabled}
          />
          <RegistrationStatusMessage registrationEnabled={registrationEnabled} />
          <AccessControlSaveFeedback saveError={saveError} saveSuccess={saveSuccess} />
        </div>
      </div>

      <UserManagementInfoBox />
    </div>
  );
};
