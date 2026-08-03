import { VariablesPage } from './Variables/VariablesPage';
import { useVariablesController } from './Variables/useVariablesController';

export function Variables() {
  const controller = useVariablesController();

  if (controller.loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading variables...</div>;
  }

  return <VariablesPage controller={controller} />;
}
