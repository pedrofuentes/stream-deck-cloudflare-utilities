/**
 * Plugin consistency validator.
 *
 * Checks that all actions, manifest entries, PI files, icons, tests, plugin
 * registrations, and README documentation are in sync.
 *
 * Run via:  npm run validate:consistency
 * Also executed as part of the prepack pipeline.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import * as fs from "node:fs";
import * as path from "node:path";

// ── Paths ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_ACTIONS = path.join(ROOT, "src", "actions");
const PLUGIN_DIR = path.join(
  ROOT,
  "com.pedrofuentes.cloudflare-utilities.sdPlugin",
);
const MANIFEST_PATH = path.join(PLUGIN_DIR, "manifest.json");
const UI_DIR = path.join(PLUGIN_DIR, "ui");
const IMGS_DIR = path.join(PLUGIN_DIR, "imgs", "actions");
const TESTS_DIR = path.join(ROOT, "tests", "actions");
const PLUGIN_TS = path.join(ROOT, "src", "plugin.ts");
const README_PATH = path.join(ROOT, "README.md");

// ── Types ──────────────────────────────────────────────────────────────────

interface ManifestAction {
  UUID: string;
  Name: string;
  Icon: string;
  PropertyInspectorPath?: string;
  States: { ShowTitle: boolean; Image: string }[];
  UserTitleEnabled: boolean;
  Tooltip?: string;
}

interface Manifest {
  Actions: ManifestAction[];
  Version: string;
  [key: string]: unknown;
}

interface ValidationError {
  category: string;
  message: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function listFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext));
}

// ── Validators ─────────────────────────────────────────────────────────────

export function validate(): ValidationError[] {
  const errors: ValidationError[] = [];

  // ── 1. Manifest exists and parses ────────────────────────────────────
  if (!fileExists(MANIFEST_PATH)) {
    errors.push({
      category: "Manifest",
      message: `manifest.json not found at ${MANIFEST_PATH}`,
    });
    return errors; // Can't continue without manifest
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readText(MANIFEST_PATH));
  } catch {
    errors.push({
      category: "Manifest",
      message: "manifest.json is not valid JSON",
    });
    return errors;
  }

  const manifestActions = manifest.Actions ?? [];

  // ── 2. Source action files ───────────────────────────────────────────
  const srcActionFiles = listFiles(SRC_ACTIONS, ".ts").filter(
    (f) => !f.endsWith(".test.ts"),
  );

  // ── 3. Plugin.ts registrations ───────────────────────────────────────
  const pluginSource = fileExists(PLUGIN_TS) ? readText(PLUGIN_TS) : "";

  // ── 4. Each manifest action must have required fields ────────────────
  for (const action of manifestActions) {
    const label = action.Name ?? action.UUID;

    // ShowTitle must be false
    if (action.States?.[0]?.ShowTitle !== false) {
      errors.push({
        category: "Manifest",
        message: `Action "${label}": States[0].ShowTitle must be false (found ${action.States?.[0]?.ShowTitle})`,
      });
    }

    // UserTitleEnabled must be false at action level
    if (action.UserTitleEnabled !== false) {
      errors.push({
        category: "Manifest",
        message: `Action "${label}": UserTitleEnabled must be false at Action level (found ${action.UserTitleEnabled})`,
      });
    }

    // PI file must exist
    if (action.PropertyInspectorPath) {
      const piPath = path.join(PLUGIN_DIR, action.PropertyInspectorPath);
      if (!fileExists(piPath)) {
        errors.push({
          category: "PI",
          message: `Action "${label}": PI file missing — ${action.PropertyInspectorPath}`,
        });
      }
    } else {
      errors.push({
        category: "PI",
        message: `Action "${label}": No PropertyInspectorPath defined in manifest`,
      });
    }

    // Icon files must exist (manifest references without extension — SVG checked)
    const iconBase = path.join(PLUGIN_DIR, action.Icon);
    const iconSvg = iconBase + ".svg";
    const iconPng = iconBase + ".png";
    if (!fileExists(iconSvg) && !fileExists(iconPng)) {
      errors.push({
        category: "Icons",
        message: `Action "${label}": Icon not found — expected ${action.Icon}.svg or .png`,
      });
    }

    // State image must exist
    const stateImgBase = path.join(
      PLUGIN_DIR,
      action.States?.[0]?.Image ?? "",
    );
    const stateImgSvg = stateImgBase + ".svg";
    const stateImgPng = stateImgBase + ".png";
    if (
      action.States?.[0]?.Image &&
      !fileExists(stateImgSvg) &&
      !fileExists(stateImgPng)
    ) {
      errors.push({
        category: "Icons",
        message: `Action "${label}": State image not found — expected ${action.States[0].Image}.svg or .png`,
      });
    }
  }

  // ── 5. Every src action must be in manifest ──────────────────────────
  for (const file of srcActionFiles) {
    const srcContent = readText(path.join(SRC_ACTIONS, file));
    const uuidMatch = srcContent.match(
      /@action\(\{\s*UUID:\s*"([^"]+)"\s*\}\)/,
    );
    if (!uuidMatch) continue; // Not an action file

    const uuid = uuidMatch[1];
    const inManifest = manifestActions.some((a) => a.UUID === uuid);
    if (!inManifest) {
      errors.push({
        category: "Manifest",
        message: `Source action "${file}" (UUID: ${uuid}) not found in manifest.json`,
      });
    }
  }

  // ── 6. Every manifest action must be registered in plugin.ts ─────────
  for (const action of manifestActions) {
    // Check that the UUID appears somewhere in plugin.ts imports/registrations
    // We check for the class import rather than the UUID string
    const uuidParts = action.UUID.split(".");
    const actionSlug = uuidParts[uuidParts.length - 1]; // e.g. "worker-analytics"

    // Find the matching source file
    const matchingSrc = srcActionFiles.find((f) => {
      const content = readText(path.join(SRC_ACTIONS, f));
      return content.includes(`UUID: "${action.UUID}"`);
    });

    if (matchingSrc) {
      // Derive class import — check plugin.ts imports the file
      const importBase = matchingSrc.replace(/\.ts$/, "");
      if (!pluginSource.includes(`./actions/${importBase}`)) {
        errors.push({
          category: "Registration",
          message: `Action "${action.Name}" (${actionSlug}): not imported in plugin.ts`,
        });
      }
      if (!pluginSource.includes("registerAction")) {
        errors.push({
          category: "Registration",
          message: `plugin.ts does not call registerAction — no actions are registered`,
        });
      }
    } else {
      errors.push({
        category: "Source",
        message: `Manifest action "${action.Name}" (UUID: ${action.UUID}): no matching source file in src/actions/`,
      });
    }
  }

  // ── 7. Every src action must have a test file ────────────────────────
  for (const file of srcActionFiles) {
    const srcContent = readText(path.join(SRC_ACTIONS, file));
    if (!srcContent.includes("@action(")) continue; // Not an action file

    const testFile = file.replace(/\.ts$/, ".test.ts");
    if (!fileExists(path.join(TESTS_DIR, testFile))) {
      errors.push({
        category: "Tests",
        message: `Action "${file}": test file missing — expected tests/actions/${testFile}`,
      });
    }
  }

  // ── 8. README mentions every manifest action ─────────────────────────
  const readme = fileExists(README_PATH) ? readText(README_PATH) : "";
  for (const action of manifestActions) {
    if (!readme.includes(action.Name)) {
      errors.push({
        category: "README",
        message: `Action "${action.Name}" not mentioned in README.md`,
      });
    }
  }

  // ── 9. package.json and manifest.json versions are in sync ───────────
  try {
    const pkg = JSON.parse(readText(path.join(ROOT, "package.json")));
    const pkgVersion: string = pkg.version ?? "";
    const manifestVersion: string = manifest.Version ?? "";
    // manifest uses x.y.z.0 format; package.json uses x.y.z
    const manifestBase = manifestVersion.replace(/\.0$/, "");
    if (pkgVersion !== manifestBase) {
      errors.push({
        category: "Version",
        message: `Version mismatch: package.json="${pkgVersion}" manifest.json="${manifestVersion}" (expected ${pkgVersion}.0)`,
      });
    }
  } catch {
    errors.push({ category: "Version", message: "Cannot read package.json" });
  }

  // ── 10. PI files reference correct API URL (no stale URLs) ───────────
  const STALE_URLS = [
    "www.cloudflarestatus.com/api",
  ];
  const piFiles = listFiles(UI_DIR, ".html");
  for (const piFile of piFiles) {
    const content = readText(path.join(UI_DIR, piFile));
    for (const staleUrl of STALE_URLS) {
      if (content.includes(staleUrl)) {
        errors.push({
          category: "PI",
          message: `${piFile}: contains stale URL "${staleUrl}" — use statuspage.io endpoint instead`,
        });
      }
    }
  }

  return errors;
}

// ── CLI runner ─────────────────────────────────────────────────────────────

if (
  process.argv[1] &&
  (process.argv[1].endsWith("validate-consistency.ts") ||
    process.argv[1].endsWith("validate-consistency.js"))
) {
  const errors = validate();
  if (errors.length === 0) {
    console.log("✅ Plugin consistency check passed — all files are in sync.");
    process.exit(0);
  } else {
    console.error(
      `❌ Plugin consistency check failed — ${errors.length} error(s):\n`,
    );
    for (const e of errors) {
      console.error(`  [${e.category}] ${e.message}`);
    }
    process.exit(1);
  }
}
