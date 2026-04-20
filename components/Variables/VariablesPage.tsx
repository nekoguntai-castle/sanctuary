import { VariablesWarning } from './VariablesWarning';
import { ThresholdsCard } from './ThresholdsCard';
import { VariablesInfo } from './VariablesInfo';
import type { VariablesController } from './types';

interface VariablesPageProps {
  controller: VariablesController;
}

export function VariablesPage({ controller }: VariablesPageProps) {
  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">System Variables</h2>
        <p className="text-sanctuary-500">Configure system-wide variables for Sanctuary</p>
      </div>

      <VariablesWarning />
      <ThresholdsCard controller={controller} />
      <VariablesInfo />
    </div>
  );
}
