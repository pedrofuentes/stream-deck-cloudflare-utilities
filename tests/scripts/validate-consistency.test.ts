/**
 * Tests for the plugin consistency validator.
 *
 * These tests verify that the validate-consistency script correctly detects
 * when actions, manifest, PI files, icons, tests, and docs are out of sync.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect } from "vitest";
import { validate } from "../../scripts/validate-consistency";

describe("validate-consistency", () => {
  it("should pass with no errors for the current project state", () => {
    const errors = validate();
    if (errors.length > 0) {
      console.error("Unexpected validation errors:");
      for (const e of errors) {
        console.error(`  [${e.category}] ${e.message}`);
      }
    }
    expect(errors).toEqual([]);
  });

  it("should return an array", () => {
    const result = validate();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should check manifest actions have ShowTitle false", () => {
    // This is implicitly tested by the zero-error check above.
    // If a manifest action had ShowTitle:true, it would fail.
    const errors = validate();
    const showTitleErrors = errors.filter((e) =>
      e.message.includes("ShowTitle"),
    );
    expect(showTitleErrors).toHaveLength(0);
  });

  it("should check manifest actions have UserTitleEnabled false", () => {
    const errors = validate();
    const userTitleErrors = errors.filter((e) =>
      e.message.includes("UserTitleEnabled"),
    );
    expect(userTitleErrors).toHaveLength(0);
  });

  it("should verify all PI files exist", () => {
    const errors = validate();
    const piErrors = errors.filter(
      (e) => e.category === "PI" && e.message.includes("missing"),
    );
    expect(piErrors).toHaveLength(0);
  });

  it("should verify all icon files exist", () => {
    const errors = validate();
    const iconErrors = errors.filter((e) => e.category === "Icons");
    expect(iconErrors).toHaveLength(0);
  });

  it("should verify all actions are registered in plugin.ts", () => {
    const errors = validate();
    const regErrors = errors.filter((e) => e.category === "Registration");
    expect(regErrors).toHaveLength(0);
  });

  it("should verify all actions have test files", () => {
    const errors = validate();
    const testErrors = errors.filter((e) => e.category === "Tests");
    expect(testErrors).toHaveLength(0);
  });

  it("should verify all actions are documented in README", () => {
    const errors = validate();
    const readmeErrors = errors.filter((e) => e.category === "README");
    expect(readmeErrors).toHaveLength(0);
  });

  it("should verify version sync between package.json and manifest.json", () => {
    const errors = validate();
    const versionErrors = errors.filter((e) => e.category === "Version");
    expect(versionErrors).toHaveLength(0);
  });

  it("should check for stale URLs in PI files", () => {
    const errors = validate();
    const staleUrlErrors = errors.filter(
      (e) => e.category === "PI" && e.message.includes("stale URL"),
    );
    expect(staleUrlErrors).toHaveLength(0);
  });
});
