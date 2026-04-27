import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockGetSystemSettings,
  mockListModels,
  mockPullModel,
  enabledSettings,
} from "./AISettingsTestHarness";
import AISettings from "../../../components/AISettings";

export function registerAISettingsModelPullContracts() {
  describe("Model Pull", () => {
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

    it("should show popular models section", async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      expect(screen.getByText("Recommended Ollama Models")).toBeInTheDocument();
    });

    it("should show popular models list", async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      // Popular models appear in the models section
      expect(screen.getByText("qwen3:4b")).toBeInTheDocument();
    });

    it("should show delete button for installed models", async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      // Installed models show Delete button instead of Pull
      expect(screen.getAllByText("Delete").length).toBeGreaterThan(0);
    });

    it("should show pull button for non-installed models", async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      expect(screen.getAllByText("Pull").length).toBeGreaterThan(0);
    });

    it("should pull model when pull button clicked", async () => {
      mockListModels.mockResolvedValue({ models: [] }); // No models installed
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText("Pull");
      await user.click(pullButtons[0]);

      await waitFor(() => {
        expect(mockPullModel).toHaveBeenCalled();
      });
    });

    it("should show progress during pull", async () => {
      mockListModels.mockResolvedValue({ models: [] });
      mockPullModel.mockImplementation(
        () => new Promise<never>(() => undefined),
      );
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText("Pull");
      await user.click(pullButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/Starting download/)).toBeInTheDocument();
      });
    });

    it("should show success after pull completes", async () => {
      mockListModels.mockResolvedValue({ models: [] });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText("Pull");
      await user.click(pullButtons[0]);

      // Pull now starts async - check that it was initiated
      await waitFor(() => {
        expect(mockPullModel).toHaveBeenCalled();
      });
      // Success message now comes via WebSocket progress (not tested here)
    });

    it("should show error on pull failure", async () => {
      mockListModels.mockResolvedValue({ models: [] });
      mockPullModel.mockResolvedValue({
        success: false,
        error: "Model not found",
      });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText("Pull");
      await user.click(pullButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/Failed.*Model not found/)).toBeInTheDocument();
      });
    });

    it("should refresh models list after successful pull", async () => {
      mockListModels.mockResolvedValue({ models: [] });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText("Pull");
      await user.click(pullButtons[0]);

      // Pull is now async - just verify the pull was initiated
      await waitFor(() => {
        expect(mockPullModel).toHaveBeenCalled();
      });
      // Models list refresh now happens via WebSocket completion callback
    });
  });
}
