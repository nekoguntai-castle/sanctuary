import { Button } from './ui/Button';
import { ErrorAlert } from './ui/ErrorAlert';
import { VariablesPage } from './Variables/VariablesPage';
import { useVariablesController } from './Variables/useVariablesController';

export function Variables() {
  const controller = useVariablesController();

  if (controller.loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading variables...</div>;
  }

  if (controller.loadError !== null) {
    return (
      <div className="p-8 space-y-4">
        <ErrorAlert message={`Failed to load system variables: ${controller.loadError}`} />
        <Button variant="secondary" onClick={() => { void controller.retryLoad(); }}>Retry</Button>
      </div>
    );
  }

  return <VariablesPage controller={controller} />;
}
