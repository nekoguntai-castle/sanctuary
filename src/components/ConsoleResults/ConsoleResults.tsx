import { ConsoleResultsContent } from "./ConsoleResultsContent";
import { useConsoleResultsViewModel } from "./consoleResultsModel";

export function ConsoleResults() {
  return <ConsoleResultsContent {...useConsoleResultsViewModel()} />;
}
