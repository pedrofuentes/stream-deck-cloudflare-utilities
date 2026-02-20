import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareApiClient } from "../../src/services/cloudflare-api-client";
import type { CloudflareStatusApiResponse } from "../../src/types/cloudflare";

// Mock the global fetch function
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("CloudflareApiClient", () => {
  let client: CloudflareApiClient;

  beforeEach(() => {
    client = new CloudflareApiClient("https://mock-api.test/api/v2");
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should use default base URL when none provided", () => {
      const defaultClient = new CloudflareApiClient();
      // The default client should be created without errors
      expect(defaultClient).toBeDefined();
    });

    it("should accept a custom base URL", () => {
      const customClient = new CloudflareApiClient("https://custom-api.test");
      expect(customClient).toBeDefined();
    });
  });

  describe("getSystemStatus", () => {
    it("should return system status when API responds successfully", async () => {
      const mockResponse: CloudflareStatusApiResponse = {
        page: { id: "page-1", name: "Cloudflare", url: "https://www.cloudflarestatus.com" },
        status: { indicator: "none", description: "All Systems Operational" },
        components: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getSystemStatus();

      expect(result).toEqual({
        indicator: "none",
        description: "All Systems Operational",
      });
      expect(mockFetch).toHaveBeenCalledWith("https://mock-api.test/api/v2/status.json");
    });

    it("should return minor indicator when there are minor issues", async () => {
      const mockResponse: CloudflareStatusApiResponse = {
        page: { id: "page-1", name: "Cloudflare", url: "https://www.cloudflarestatus.com" },
        status: { indicator: "minor", description: "Minor System Issue" },
        components: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getSystemStatus();

      expect(result.indicator).toBe("minor");
      expect(result.description).toBe("Minor System Issue");
    });

    it("should return major indicator during major outages", async () => {
      const mockResponse: CloudflareStatusApiResponse = {
        page: { id: "page-1", name: "Cloudflare", url: "https://www.cloudflarestatus.com" },
        status: { indicator: "major", description: "Major System Outage" },
        components: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getSystemStatus();

      expect(result.indicator).toBe("major");
    });

    it("should return critical indicator during critical outages", async () => {
      const mockResponse: CloudflareStatusApiResponse = {
        page: { id: "page-1", name: "Cloudflare", url: "https://www.cloudflarestatus.com" },
        status: { indicator: "critical", description: "Critical System Outage" },
        components: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getSystemStatus();

      expect(result.indicator).toBe("critical");
    });

    it("should throw an error when API returns non-OK status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.getSystemStatus()).rejects.toThrow(
        "Failed to fetch Cloudflare status: HTTP 500 Internal Server Error"
      );
    });

    it("should throw an error when API returns 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(client.getSystemStatus()).rejects.toThrow(
        "Failed to fetch Cloudflare status: HTTP 404 Not Found"
      );
    });

    it("should throw an error when API returns 429 rate limit", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      await expect(client.getSystemStatus()).rejects.toThrow(
        "Failed to fetch Cloudflare status: HTTP 429 Too Many Requests"
      );
    });

    it("should throw when network request fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.getSystemStatus()).rejects.toThrow("Network error");
    });

    it("should throw when JSON parsing fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });

      await expect(client.getSystemStatus()).rejects.toThrow("Unexpected token");
    });
  });

  describe("getComponents", () => {
    it("should return components when API responds successfully", async () => {
      const mockResponse = {
        components: [
          {
            id: "comp-1",
            name: "CDN/Cache",
            status: "operational",
            description: "Cloudflare CDN",
          },
          {
            id: "comp-2",
            name: "DNS",
            status: "operational",
            description: null,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getComponents();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "comp-1",
        name: "CDN/Cache",
        status: "operational",
        description: "Cloudflare CDN",
      });
      expect(result[1]).toEqual({
        id: "comp-2",
        name: "DNS",
        status: "operational",
        description: null,
      });
    });

    it("should return empty array when no components exist", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ components: [] }),
      });

      const result = await client.getComponents();

      expect(result).toEqual([]);
    });

    it("should handle components with degraded_performance status", async () => {
      const mockResponse = {
        components: [
          {
            id: "comp-1",
            name: "CDN/Cache",
            status: "degraded_performance",
            description: null,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getComponents();

      expect(result[0].status).toBe("degraded_performance");
    });

    it("should handle components with partial_outage status", async () => {
      const mockResponse = {
        components: [
          {
            id: "comp-1",
            name: "DNS",
            status: "partial_outage",
            description: "DNS resolution issues",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getComponents();

      expect(result[0].status).toBe("partial_outage");
    });

    it("should handle components with major_outage status", async () => {
      const mockResponse = {
        components: [
          {
            id: "comp-1",
            name: "API",
            status: "major_outage",
            description: "API completely unavailable",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getComponents();

      expect(result[0].status).toBe("major_outage");
    });

    it("should throw error when API returns non-OK status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      await expect(client.getComponents()).rejects.toThrow(
        "Failed to fetch Cloudflare components: HTTP 503 Service Unavailable"
      );
    });

    it("should throw when network request fails", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(client.getComponents()).rejects.toThrow("Failed to fetch");
    });

    it("should correctly map only required fields from the response", async () => {
      const mockResponse = {
        components: [
          {
            id: "comp-1",
            name: "CDN",
            status: "operational",
            description: "Test",
            extra_field: "should be ignored",
            created_at: "2021-01-01",
            updated_at: "2021-01-02",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getComponents();

      expect(Object.keys(result[0])).toEqual(["id", "name", "status", "description"]);
    });
  });

  describe("getSummary", () => {
    it("should return full summary when API responds successfully", async () => {
      const mockResponse: CloudflareStatusApiResponse = {
        page: {
          id: "yh6f0r4529hb",
          name: "Cloudflare Status",
          url: "https://www.cloudflarestatus.com",
        },
        status: {
          indicator: "none",
          description: "All Systems Operational",
        },
        components: [
          {
            id: "comp-1",
            name: "CDN/Cache",
            status: "operational",
            description: null,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getSummary();

      expect(result.page.name).toBe("Cloudflare Status");
      expect(result.status.indicator).toBe("none");
      expect(result.components).toHaveLength(1);
    });

    it("should throw error when API returns non-OK status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
      });

      await expect(client.getSummary()).rejects.toThrow(
        "Failed to fetch Cloudflare summary: HTTP 502 Bad Gateway"
      );
    });

    it("should throw when network is unavailable", async () => {
      mockFetch.mockRejectedValueOnce(new Error("net::ERR_INTERNET_DISCONNECTED"));

      await expect(client.getSummary()).rejects.toThrow("net::ERR_INTERNET_DISCONNECTED");
    });

    it("should use the correct endpoint URL", async () => {
      const mockResponse: CloudflareStatusApiResponse = {
        page: { id: "p1", name: "CF", url: "https://test.com" },
        status: { indicator: "none", description: "OK" },
        components: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await client.getSummary();

      expect(mockFetch).toHaveBeenCalledWith("https://mock-api.test/api/v2/summary.json");
    });
  });
});
