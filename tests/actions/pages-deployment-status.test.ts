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
  type PagesDeploymentStatus as PagesDeployStatus,
} from "../../src/services/cloudflare-pages-api";
import { STATUS_COLORS, formatTimeAgo } from "../../src/services/key-image-renderer";
import { getGlobalSettings, onGlobalSettingsChanged } from "../../src/services/global-settings-store";
import { resetPollingCoordinator } from "../../src/services/polling-coordinator";

// ── Mocks ────────────────────────────────────────────────────────────────────

let capturedGlobalListener: ((settings: Record<string, unknown>) => void) | null = null;
vi.mock("../../src/services/global-settings-store", () => ({
  getGlobalSettings: vi.fn(),
  onGlobalSettingsChanged: vi.fn().mockImplementation((fn: (settings: Record<string, unknown>) => void) => {
    capturedGlobalListener = fn;
    return vi.fn();
  }),
}));

vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: { debug: vi.fn(), error: vi.fn(), setLevel: vi.fn() },
    actions: { registerAction: vi.fn() },
    connect: vi.fn(),
  },
  action: () => (target: unknown) => target,
  SingletonAction: class {},
}));

let mockGetDeploymentStatus: ReturnType<typeof vi.fn>;

vi.mock("../../src/services/cloudflare-pages-api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/services/cloudflare-pages-api")>();
  return {
    ...orig,
    CloudflarePagesApi: class MockCloudflarePagesApi {
      constructor() { this.getDeploymentStatus = mockGetDeploymentStatus; }
      getDeploymentStatus: ReturnType<typeof vi.fn>;
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockEvent(settings: Record<string, unknown> = {}) {
  return {
    payload: { settings },
    action: {
      setImage: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(undefined),
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
    createdOn: new Date().toISOString(),
    deploymentId: "deploy-123",
    ...overrides,
  };
}

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(dataUri.slice(prefix.length));
}

const VALID_SETTINGS = { projectName: "myproj" };

// ── Tests ────────────────────────────────────────────────────────────────────

describe("truncateProjectName", () => {
  it("should return names ≤ 10 chars unchanged", () => { expect(truncateProjectName("my-project")).toBe("my-project"); });
  it("should truncate names > 10 chars", () => { expect(truncateProjectName("my-very-long-project")).toBe("my-very-l…"); });
  it("should handle empty string", () => { expect(truncateProjectName("")).toBe(""); });
});

describe("formatTimeAgo (in Pages context)", () => {
  it("should format seconds ago", () => {
    const date = new Date(Date.now() - 30_000).toISOString();
    expect(formatTimeAgo(date)).toMatch(/\d+s ago/);
  });
  it("should format minutes ago", () => {
    const date = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatTimeAgo(date)).toMatch(/\d+m ago/);
  });
  it("should format hours ago", () => {
    const date = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatTimeAgo(date)).toMatch(/\d+h ago/);
  });
  it("should format days ago", () => {
    const date = new Date(Date.now() - 48 * 3_600_000).toISOString();
    expect(formatTimeAgo(date)).toMatch(/\d+d ago/);
  });
});

describe("PagesDeploymentStatus", () => {
  let action: PagesDeploymentStatus;

  beforeEach(() => {
    action = new PagesDeploymentStatus();
    mockGetDeploymentStatus = vi.fn();
    capturedGlobalListener = null;
    vi.mocked(getGlobalSettings).mockReturnValue({ apiToken: "test-token", accountId: "test-account" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetPollingCoordinator();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── resolveState ─────────────────────────────────────────────────────

  describe("resolveState", () => {
    it("should return 'success' for successful deployment", () => { expect(action.resolveState(makeStatus())).toBe("success"); });
    it("should return 'building' for in-progress deployment", () => { expect(action.resolveState(makeStatus({ isSuccess: false, isBuilding: true }))).toBe("building"); });
    it("should return 'failed' for failed deployment", () => { expect(action.resolveState(makeStatus({ isSuccess: false, isFailed: true }))).toBe("failed"); });
    it("should return 'failed' over building when both set", () => { expect(action.resolveState(makeStatus({ isSuccess: false, isBuilding: true, isFailed: true }))).toBe("failed"); });
    it("should default to 'success' when none set", () => { expect(action.resolveState(makeStatus({ isSuccess: false }))).toBe("success"); });
  });

  // ── renderStatus ─────────────────────────────────────────────────────

  describe("renderStatus", () => {
    it("should return a data URI", () => { expect(action.renderStatus("success", "myproj")).toMatch(/^data:image\/svg\+xml,/); });
    it("should render error with red color", () => { expect(decodeSvg(action.renderStatus("error", "myproj"))).toContain(STATUS_COLORS.red); });
    it("should show ERR in error state", () => { expect(decodeSvg(action.renderStatus("error", "myproj"))).toContain("ERR"); });
    it("should show custom error message", () => { expect(decodeSvg(action.renderStatus("error", "p", "No deploys"))).toContain("No deploys"); });
    it("should include project name", () => { expect(decodeSvg(action.renderStatus("success", "myproj"))).toContain("myproj"); });
    it("should render building with amber color", () => {
      const svg = decodeSvg(action.renderStatus("building", "p", undefined, makeStatus({ isBuilding: true })));
      expect(svg).toContain(STATUS_COLORS.amber);
      expect(svg).toContain("Building");
    });
    it("should include branch in building state", () => {
      const svg = decodeSvg(action.renderStatus("building", "p", undefined, makeStatus({ isBuilding: true, branch: "dev" })));
      expect(svg).toContain("dev");
    });
    it("should render success with green color", () => {
      const svg = decodeSvg(action.renderStatus("success", "p", undefined, makeStatus()));
      expect(svg).toContain(STATUS_COLORS.green);
    });
    it("should include branch and commit in success", () => {
      const svg = decodeSvg(action.renderStatus("success", "p", undefined, makeStatus()));
      expect(svg).toContain("main");
      expect(svg).toContain("abc12");
    });
    it("should render failed with red color", () => {
      const svg = decodeSvg(action.renderStatus("failed", "p", undefined, makeStatus({ isFailed: true })));
      expect(svg).toContain(STATUS_COLORS.red);
    });
    it("should use displayName when provided", () => {
      const svg = decodeSvg(action.renderStatus("success", "longname", undefined, makeStatus(), "short"));
      expect(svg).toContain("short");
      expect(svg).not.toContain("longname");
    });
  });

  // ── hasRequiredSettings / hasCredentials ──────────────────────────────

  describe("hasRequiredSettings", () => {
    it("should return true with projectName, apiToken, accountId", () => { expect(action.hasRequiredSettings({ projectName: "p" }, { apiToken: "t", accountId: "a" })).toBe(true); });
    it("should return false without projectName", () => { expect(action.hasRequiredSettings({}, { apiToken: "t", accountId: "a" })).toBe(false); });
    it("should return false without apiToken", () => { expect(action.hasRequiredSettings({ projectName: "p" }, { accountId: "a" })).toBe(false); });
    it("should return false without accountId", () => { expect(action.hasRequiredSettings({ projectName: "p" }, { apiToken: "t" })).toBe(false); });
  });

  describe("hasCredentials", () => {
    it("should return true with both present", () => { expect(action.hasCredentials({ apiToken: "t", accountId: "a" })).toBe(true); });
    it("should return false without apiToken", () => { expect(action.hasCredentials({ accountId: "a" })).toBe(false); });
    it("should return false without accountId", () => { expect(action.hasCredentials({ apiToken: "t" })).toBe(false); });
    it("should return false when both missing", () => { expect(action.hasCredentials({})).toBe(false); });
  });

  // ── onWillAppear ─────────────────────────────────────────────────────

  describe("onWillAppear", () => {
    it("should show setup image when credentials missing", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });

    it("should show placeholder when projectName missing", async () => {
      const ev = makeMockEvent({});
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("...");
    });

    it("should fetch and display deployment status", async () => {
      mockGetDeploymentStatus.mockResolvedValueOnce(makeStatus());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(mockGetDeploymentStatus).toHaveBeenCalledWith("myproj");
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.green);
      expect(svg).toContain("myproj");
    });

    it("should show ERR on API failure", async () => {
      mockGetDeploymentStatus.mockRejectedValueOnce(new Error("Net error"));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("ERR");
    });

    it("should show 'No deploys' when no deployments exist", async () => {
      mockGetDeploymentStatus.mockResolvedValueOnce(null);
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("No deploys");
    });

    it("should schedule refresh via coordinator", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);
    });

    it("should display building state with amber", async () => {
      mockGetDeploymentStatus.mockResolvedValueOnce(makeStatus({ isSuccess: false, isBuilding: true }));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      const svg = decodeSvg(ev.action.setImage.mock.calls[0][0]);
      expect(svg).toContain(STATUS_COLORS.amber);
      expect(svg).toContain("Building");
    });

    it("should display failed state with red", async () => {
      mockGetDeploymentStatus.mockResolvedValueOnce(makeStatus({ isSuccess: false, isFailed: true }));
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain(STATUS_COLORS.red);
    });
  });

  // ── onDidReceiveSettings ─────────────────────────────────────────────

  describe("onDidReceiveSettings", () => {
    it("should show setup when credentials removed", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });

    it("should refetch on settings change", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      await action.onDidReceiveSettings(makeMockEvent({ projectName: "other" }));
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(2);
    });

    it("should show placeholder when projectName removed", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      const ev = makeMockEvent({});
      await action.onDidReceiveSettings(ev);
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("...");
    });
  });

  // ── onWillDisappear ──────────────────────────────────────────────────

  describe("onWillDisappear", () => {
    it("should clean up without error", () => { expect(() => action.onWillDisappear({} as any)).not.toThrow(); });

    it("should stop polling", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      action.onWillDisappear({} as any);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);
    });
  });

  // ── onKeyDown ────────────────────────────────────────────────────────

  describe("onKeyDown", () => {
    it("should trigger manual refresh", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      mockGetDeploymentStatus.mockClear();
      mockGetDeploymentStatus.mockResolvedValueOnce(makeStatus({ branch: "dev" }));
      const keyEv = makeMockEvent(VALID_SETTINGS);
      await action.onKeyDown(keyEv);
      expect(mockGetDeploymentStatus).toHaveBeenCalledTimes(1);
      expect(decodeSvg(keyEv.action.setImage.mock.calls[0][0])).toContain("dev");
    });

    it("should do nothing when settings incomplete", async () => {
      vi.mocked(getGlobalSettings).mockReturnValue({});
      const ev = makeMockEvent({});
      await action.onKeyDown(ev);
      expect(mockGetDeploymentStatus).not.toHaveBeenCalled();
    });
  });

  // ── error back-off ───────────────────────────────────────────────────

  describe("error back-off", () => {
    it("should skip polls during backoff window", async () => {
      mockGetDeploymentStatus.mockRejectedValueOnce(new Error("API Error"));
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      mockGetDeploymentStatus.mockClear();
      // Within 30s backoff — should skip
      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockGetDeploymentStatus).not.toHaveBeenCalled();
    });

    it("should resume after backoff expires", async () => {
      mockGetDeploymentStatus.mockRejectedValueOnce(new Error("API Error"));
      await action.onWillAppear(makeMockEvent(VALID_SETTINGS));
      mockGetDeploymentStatus.mockClear();
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockGetDeploymentStatus).toHaveBeenCalled();
    });
  });

  // ── display refresh (60s interval) ───────────────────────────────────

  describe("display refresh", () => {
    it("should update time-ago display periodically", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      const initialCalls = ev.action.setImage.mock.calls.length;
      // Advance 60s for display refresh (not coordinator poll)
      // Coordinator also fires at 60s so we get both
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ev.action.setImage.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  // ── marquee ──────────────────────────────────────────────────────────

  describe("marquee", () => {
    const LONG_SETTINGS = { projectName: "my-very-long-project" };

    it("should scroll for long project names", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      await vi.advanceTimersByTimeAsync(2000);
      expect(ev.action.setImage.mock.calls.length).toBeGreaterThan(0);
    });

    it("should not scroll for short names", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      await vi.advanceTimersByTimeAsync(3000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });

    it("should stop on disappear", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      const ev = makeMockEvent(LONG_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      action.onWillDisappear(ev);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ev.action.setImage).not.toHaveBeenCalled();
    });
  });

  // ── global settings change ───────────────────────────────────────────

  describe("global settings change", () => {
    it("should re-initialize when credentials change", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      mockGetDeploymentStatus.mockResolvedValueOnce(makeStatus({ branch: "new-branch" }));
      await capturedGlobalListener!({ apiToken: "new-token", accountId: "new-acc" });
      expect(ev.action.setImage).toHaveBeenCalled();
    });

    it("should show setup when credentials removed", async () => {
      mockGetDeploymentStatus.mockResolvedValue(makeStatus());
      const ev = makeMockEvent(VALID_SETTINGS);
      await action.onWillAppear(ev);
      ev.action.setImage.mockClear();
      vi.mocked(getGlobalSettings).mockReturnValue({});
      await capturedGlobalListener!({});
      expect(decodeSvg(ev.action.setImage.mock.calls[0][0])).toContain("Setup");
    });
  });
});
