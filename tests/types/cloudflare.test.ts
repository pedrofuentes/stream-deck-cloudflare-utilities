/**
 * Tests for Cloudflare type definitions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect } from "vitest";
import type {
  CloudflareSystemStatus,
  CloudflareComponent,
  CloudflareStatusApiResponse,
} from "../../src/types/cloudflare";

describe("Cloudflare Types", () => {
  describe("CloudflareSystemStatus", () => {
    it("should accept valid system status objects", () => {
      const status: CloudflareSystemStatus = {
        indicator: "none",
        description: "All Systems Operational",
      };

      expect(status.indicator).toBe("none");
      expect(status.description).toBe("All Systems Operational");
    });

    it("should accept all valid indicator values", () => {
      const indicators = ["none", "minor", "major", "critical"];
      indicators.forEach((indicator) => {
        const status: CloudflareSystemStatus = {
          indicator,
          description: `Status: ${indicator}`,
        };
        expect(status.indicator).toBe(indicator);
      });
    });
  });

  describe("CloudflareComponent", () => {
    it("should accept valid component objects with description", () => {
      const component: CloudflareComponent = {
        id: "comp-123",
        name: "CDN/Cache",
        status: "operational",
        description: "Content Delivery Network",
      };

      expect(component.id).toBe("comp-123");
      expect(component.name).toBe("CDN/Cache");
      expect(component.status).toBe("operational");
      expect(component.description).toBe("Content Delivery Network");
    });

    it("should accept component objects with null description", () => {
      const component: CloudflareComponent = {
        id: "comp-456",
        name: "DNS",
        status: "operational",
        description: null,
      };

      expect(component.description).toBeNull();
    });

    it("should accept all valid component status values", () => {
      const statuses = [
        "operational",
        "degraded_performance",
        "partial_outage",
        "major_outage",
      ];

      statuses.forEach((status) => {
        const component: CloudflareComponent = {
          id: "comp-1",
          name: "Test",
          status,
          description: null,
        };
        expect(component.status).toBe(status);
      });
    });
  });

  describe("CloudflareStatusApiResponse", () => {
    it("should accept a valid complete API response", () => {
      const response: CloudflareStatusApiResponse = {
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

      expect(response.page.id).toBe("yh6f0r4529hb");
      expect(response.status.indicator).toBe("none");
      expect(response.components).toHaveLength(1);
    });

    it("should accept a response with empty components array", () => {
      const response: CloudflareStatusApiResponse = {
        page: {
          id: "page-1",
          name: "CF Status",
          url: "https://test.com",
        },
        status: {
          indicator: "none",
          description: "OK",
        },
        components: [],
      };

      expect(response.components).toHaveLength(0);
    });

    it("should accept a response with multiple components", () => {
      const response: CloudflareStatusApiResponse = {
        page: {
          id: "page-1",
          name: "CF Status",
          url: "https://test.com",
        },
        status: {
          indicator: "minor",
          description: "Minor issues",
        },
        components: [
          { id: "1", name: "CDN", status: "operational", description: null },
          { id: "2", name: "DNS", status: "partial_outage", description: "DNS issues" },
          { id: "3", name: "API", status: "operational", description: "REST API" },
        ],
      };

      expect(response.components).toHaveLength(3);
      expect(response.components[1].status).toBe("partial_outage");
    });
  });
});
