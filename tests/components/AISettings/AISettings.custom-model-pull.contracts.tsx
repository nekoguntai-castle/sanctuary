import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockGetSystemSettings,
  mockPullModel,
  enabledSettings,
} from "./AISettingsTestHarness";
import AISettings from "../../../components/AISettings";

export function registerAISettingsCustomModelPullContracts() {
  describe("Custom Model Pull", () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find((el) => el.classList.contains("hidden"));
      return tabSpan?.closest("button");
    };

    const navigateToModelsTab = async (
      user: ReturnType<typeof userEvent.setup>,
    ) => {
      await waitFor(() => {
        expect(screen.getByText("AI Settings")).toBeInTheDocument();
      });
      const modelsTab = getTabButton("Models");
      expect(modelsTab).not.toBeNull();
      await user.click(modelsTab!);
      await waitFor(() => {
        expect(
          screen.getByText("Recommended Ollama Models"),
        ).toBeInTheDocument();
      });
    };

    it("should show custom model input", async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      expect(screen.getByPlaceholderText(/qwen3/)).toBeInTheDocument();
    });

    it("should pull custom model", async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const input = screen.getByPlaceholderText(/qwen3/);
      await user.type(input, "custom-model:latest");

      // Find the pull button next to the custom input
      const pullButtons = screen.getAllByText("Pull");
      const customPullButton = pullButtons[pullButtons.length - 1]; // Last pull button

      await user.click(customPullButton);

      await waitFor(() => {
        expect(mockPullModel).toHaveBeenCalledWith("custom-model:latest");
      });
    });

    it("should disable pull button when input is empty", async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      // Find the custom pull section's button - it's next to the input
      const customInput = screen.getByPlaceholderText(/qwen3/);
      const customSection = customInput.closest("div");
      const pullButton = customSection?.querySelector("button");

      expect(pullButton).toBeDisabled();
    });
  });
}
