import type React from 'react';

export function ModalFrame({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="surface-elevated rounded-xl p-6 max-w-md w-full border border-sanctuary-200 dark:border-sanctuary-800">
        <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-4">
          {title}
        </h3>
        <div className="space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}

export function InfoBox({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-900 dark:text-blue-100">
      <p className="font-medium mb-1">{title}</p>
      <p className="text-xs text-blue-700 dark:text-blue-300">
        {body}
      </p>
    </div>
  );
}
