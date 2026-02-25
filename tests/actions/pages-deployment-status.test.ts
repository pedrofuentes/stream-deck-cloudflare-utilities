/**
 * Tests for the Pages Deployment Status action.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PagesDeploymentStatus,
} from "../../src/actions/pages-deployment-status";
import {
  truncateProjectName,
  formatTimeAgo,
  type PagesDeploymentStatus as PagesDeployStatus,
} from "../../src/services/cloudflare-pages-api";
import { STATUS_COLORS } from "../../src/services/key-image-renderer";

// Mock @elgato/streamdeck
vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: { error: vi.fn(), debug: vi.fn(), setLevel: vi.fn() },
    actions: { registerAction: vi.fn() },
    connect: vi.fn(),
  },
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));

// Mock the global settings store
vi.mock("../../src/services/global-settings-store", () => ({
  getGlobalSettings: vi.fn(() => ({
    apiToken: "mock-token",
    accountId: "mock-account-id",
  })),
  onGlobalSettingsChanged: vi.fn(() => vi.fn()),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockEvent(
  settings: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
) {
  return {
    payload: { settings },
    action: {
      setImage: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function makeStatus(overrides?: Partial<PagesDeployStatus>): PagesDeployStatus {
  return {
    isSuccess: true,
    isBuilding: false,
    isFailed: false,
    branch: "main",
    commitHash: "abc1234",
    commitMessage: "fix: something",
    environment: "production",
    createdOn: "2025-06-15T12:00:00Z",
    deploymentId: "deploy-123",
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PagesDeploymentStatus", () => {
  // ── resolveState ─────────────────────────────────────────────────────

  describe("resolveState", () => {
    let action: PagesDeploymentStatus;

    beforeEach(() => {
      action = new PagesDeploymentStatus();
    });

    it("should return 'success' for successful deployment", () => {
      expect(action.resolveState(makeStatus())).toBe("success");
    });

    it("should return 'building' for in-progress deployment", () => {
      expect(
        action.resolveState(makeStatus({ isSuccess: false, isBuilding: true }))
      ).toBe("building");
    });

    it("should return 'failed' for failed deployment", () => {
      expect(
        action.resolveState(makeStatus({ isSuccess: false, isFailed: true }))
      ).toBe("failed");
    });

    it("should return 'failed' over building when both set", () => {
      expect(
        action.resolveState(
          makeStatus({ isSuccess: false, isBuilding: true, isFailed: true })
        )
      ).toBe("failed");
    });
  });

  // ── renderStatus ─────────────────────────────────────────────────────

  describe("renderStatus", () => {
    let action: PagesDeploymentStatus;

    beforeEach(() => {
      action = new PagesDeploymentStatus();
    });

    it("should return a data URI", () => {
      const result = action.renderStatus("success", "myproject");
      expect(result).toMatch(/^data:image\/svg\+xml,/);
    });

    it("should render error state with red color", () => {
      const svg = decodeSvg(action.renderStatus("error", "myproject"));
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should include project name", () => {
      const svg = decodeSvg(action.renderStatus("success", "myproject"));
      expect(svg).toContain("myproject");
    });

    it("should render building state with amber color", () => {
      const svg = decodeSvg(
        action.renderStatus("building", "myproj", undefined, makeStatus({ isBuilding: true }))
      );
      expect(svg).toContain(STATUS_COLORS.amber);
      expect(svg).toContain("Building");
    });

    it("should render success state with green color", () => {
      const svg = decodeSvg(
        action.renderStatus("success", "myproj", undefined, makeStatus())
      );
      expect(svg).toContain(STATUS_COLORS.green);
    });

    it("should include branch and commit in success state", () => {
      const svg = decodeSvg(
        action.renderStatus("success", "p", undefined, makeStatus())
      );
      // "main • abc1234" is 14 chars → truncated to 13: "main • abc12…"
      expect(svg).toContain("main");
      expect(svg).toContain("abc12");
    });

    it("should use displayName when provided", () => {
      const svg = decodeSvg(
        action.renderStatus("success", "longprojectname", undefined, makeStatus(), "short")
      );
      expect(svg).toContain("short");
      expect(svg).not.toContain("longprojectname");
    });

    it("should render failed state with red color", () => {
      const svg = decodeSvg(
        action.renderStatus("failed", "myproj", undefined, makeStatus({ isFailed: true }))
      );
      expect(svg).toContain(STATUS_COLORS.red);
    });

    it("should show error message in error state", () => {
      const svg = decodeSvg(
        action.renderStatus("error", "myproj", "No deploys")
      );
      expect(svg).toContain("No deploys");
    });
  });

  // ── hasRequiredSettings ──────────────────────────────────────────────

  describe("hasRequiredSettings", () => {
    let action: PagesDeploymentStatus;

    beforeEach(() => {
      action = new PagesDeploymentStatus();
    });

    it("should return true when all settings present", () => {
      expect(
        action.hasRequiredSettings(
          { projectName: "my-project" },
          { apiToken: "t", accountId: "a" }
        )
      ).toBe(true);
    });

    it("should return false when projectName is missing", () => {
      expect(
        action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })
      ).toBe(false);
    });

    it("should return false when apiToken is missing", () => {
      expect(
        action.hasRequiredSettings({ projectName: "p" }, { accountId: "a" })
      ).toBe(false);
    });

    it("should return false when accountId is missing", () => {
      expect(
        action.hasRequiredSettings({ projectName: "p" }, { apiToken: "t" })
      ).toBe(false);
    });
  });

  // ── hasCredentials ───────────────────────────────────────────────────

  describe("hasCredentials", () => {
    let action: PagesDeploymentStatus;

    beforeEach(() => {
      action = new PagesDeploymentStatus();
    });

    it("should return true when both present", () => {
      expect(action.hasCredentials({ apiToken: "t", accountId: "a" })).toBe(true);
    });

    it("should return false when apiToken is missing", () => {
      expect(action.hasCredentials({ accountId: "a" })).toBe(false);
    });

    it("should return false when accountId is missing", () => {
      expect(action.hasCredentials({ apiToken: "t" })).toBe(false);
    });

    it("should return false when both missing", () => {
      expect(action.hasCredentials({})).toBe(false);
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────────

  describe("onWillAppear", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should show setup image when credentials missing", async () => {
      vi.useFakeTimers();
      const { getGlobalSettings } = await import(
        "../../src/services/global-settings-store"
      );
      (getGlobalSettings as any).mockReturnValueOnce({});

      const action = new PagesDeploymentStatus();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("Setup");
      vi.useRealTimers();
    });

    it("should show placeholder when credentials present but projectName missing", async () => {
      vi.useFakeTimers();

      const action = new PagesDeploymentStatus();
      const ev = makeMockEvent({});

      await action.onWillAppear(ev);

      expect(ev.action.setImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/svg+xml,")
      );
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain("...");
      vi.useRealTimers();
    });
  });

  describe("onWillDisappear", () => {
    it("should clean up without error", () => {
      const action = new PagesDeploymentStatus();
      expect(() => action.onWillDisappear({} as any)).not.toThrow();
    });
  });

  // ── truncateProjectName ──────────────────────────────────────────────

  describe("truncateProjectName", () => {
    it("should return names ≤ 10 chars unchanged", () => {
      expect(truncateProjectName("my-project")).toBe("my-project");
    });

    it("should truncate and add ellipsis for names > 10 chars", () => {
      expect(truncateProjectName("my-very-long-project")).toBe("my-very-l…");
    });

    it("should handle empty string", () => {
      expect(truncateProjectName("")).toBe("");
    });
  });

  // ── formatTimeAgo ────────────────────────────────────────────────────

  describe("formatTimeAgo", () => {
    it("should format seconds ago", () => {
      const date = new Date(Date.now() - 30 * 1000).toISOString();
      const result = formatTimeAgo(date);
      expect(result).toMatch(/\d+s ago/);
    });

    it("should format minutes ago", () => {
      const date = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const result = formatTimeAgo(date);
      expect(result).toMatch(/\d+m ago/);
    });

    it("should format hours ago", () => {
      const date = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const result = formatTimeAgo(date);
      expect(result).toMatch(/\d+h ago/);
    });

    it("should format days ago", () => {
      const date = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const result = formatTimeAgo(date);
      expect(result).toMatch(/\d+d ago/);
    });
  });
});
