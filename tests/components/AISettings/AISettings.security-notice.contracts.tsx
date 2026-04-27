import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "./AISettingsTestHarness";
import AISettings from "../../../components/AISettings";

export function registerAISettingsSecurityNoticeContracts() {
  describe("Security Notice", () => {
    it("should show security notice", async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText("AI Data Boundary")).toBeInTheDocument();
      });
    });

    it("should explain security measures", async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(
          screen.getByText(/no access to private keys/),
        ).toBeInTheDocument();
      });
    });
  });
}
