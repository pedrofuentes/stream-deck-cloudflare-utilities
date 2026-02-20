import { describe, it, expect, beforeEach } from "vitest";
import { CloudflareStatus } from "../../src/actions/cloudflare-status";

describe("CloudflareStatus", () => {
  describe("formatStatusTitle", () => {
    let action: CloudflareStatus;

    beforeEach(() => {
      // Create action without connecting to Stream Deck
      action = new CloudflareStatus();
    });

    it('should return "✓ OK" for "none" indicator', () => {
      expect(action.formatStatusTitle("none")).toBe("✓ OK");
    });

    it('should return "⚠ Minor" for "minor" indicator', () => {
      expect(action.formatStatusTitle("minor")).toBe("⚠ Minor");
    });

    it('should return "✖ Major" for "major" indicator', () => {
      expect(action.formatStatusTitle("major")).toBe("✖ Major");
    });

    it('should return "🔴 Crit" for "critical" indicator', () => {
      expect(action.formatStatusTitle("critical")).toBe("🔴 Crit");
    });

    it('should return "? N/A" for unknown indicator values', () => {
      expect(action.formatStatusTitle("unknown")).toBe("? N/A");
    });

    it('should return "? N/A" for empty string indicator', () => {
      expect(action.formatStatusTitle("")).toBe("? N/A");
    });

    it("should handle case-sensitive indicators correctly", () => {
      // API returns lowercase - uppercase should be treated as unknown
      expect(action.formatStatusTitle("None")).toBe("? N/A");
      expect(action.formatStatusTitle("MINOR")).toBe("? N/A");
      expect(action.formatStatusTitle("Major")).toBe("? N/A");
      expect(action.formatStatusTitle("CRITICAL")).toBe("? N/A");
    });

    it('should return "? N/A" for unexpected status strings', () => {
      expect(action.formatStatusTitle("degraded")).toBe("? N/A");
      expect(action.formatStatusTitle("outage")).toBe("? N/A");
      expect(action.formatStatusTitle("maintenance")).toBe("? N/A");
    });
  });
});
