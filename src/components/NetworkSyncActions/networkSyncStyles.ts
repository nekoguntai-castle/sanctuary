interface SyncButtonStyleState {
  isDisabled: boolean;
  syncing: boolean;
}

interface ResyncButtonStyleState {
  isDisabled: boolean;
  resyncing: boolean;
}

const compactBase = 'p-2 rounded-lg transition-all';
const fullBase = 'inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all';

const joinClasses = (...classes: string[]) => classes.filter(Boolean).join(' ');

export const getCompactSyncButtonClassName = ({
  isDisabled,
  syncing,
}: SyncButtonStyleState) => {
  if (isDisabled) {
    return joinClasses(compactBase, 'text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed');
  }

  if (syncing) {
    return joinClasses(compactBase, 'text-primary-600 dark:text-primary-400 bg-primary-100 dark:bg-primary-900/30');
  }

  return joinClasses(
    compactBase,
    'text-sanctuary-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
  );
};

export const getCompactResyncButtonClassName = ({
  isDisabled,
  resyncing,
}: ResyncButtonStyleState) => {
  if (isDisabled) {
    return joinClasses(compactBase, 'text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed');
  }

  if (resyncing) {
    return joinClasses(compactBase, 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30');
  }

  return joinClasses(
    compactBase,
    'text-sanctuary-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
  );
};

export const getFullSyncButtonClassName = ({
  isDisabled,
  syncing,
}: SyncButtonStyleState) => {
  if (isDisabled) {
    return joinClasses(
      fullBase,
      'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed'
    );
  }

  if (syncing) {
    return joinClasses(fullBase, 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400');
  }

  return joinClasses(
    fullBase,
    'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 border border-primary-200 dark:border-primary-800'
  );
};

export const getFullResyncButtonClassName = ({
  isDisabled,
  resyncing,
}: ResyncButtonStyleState) => {
  if (isDisabled) {
    return joinClasses(
      fullBase,
      'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed'
    );
  }

  if (resyncing) {
    return joinClasses(fullBase, 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400');
  }

  return joinClasses(
    fullBase,
    'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800'
  );
};

export const getSyncIconClassName = (syncing: boolean, marginClass = '') => (
  joinClasses('w-4 h-4', marginClass, syncing ? 'animate-spin' : '')
);

export const getResyncIconClassName = (resyncing: boolean, marginClass = '') => (
  joinClasses('w-4 h-4', marginClass, resyncing ? 'animate-pulse' : '')
);
