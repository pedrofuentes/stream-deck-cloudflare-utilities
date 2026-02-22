/**
 * Convert SVG assets in content/assets/ to PNG files.
 *
 * Usage: npx tsx scripts/convert-content-assets.ts
 *
 * This script converts all SVG files in content/assets/ to PNG files
 * at their native SVG viewBox dimensions.
 *
 * Special handling:
 * - icon.svg → 288×288 PNG
 * - thumbnail.svg → 1920×960 PNG
 * - gallery-*.svg → 1920×960 PNG
 */

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, basename, extname } from "path";

const ASSETS_DIR = join(import.meta.dirname, "..", "content", "assets");

const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".svg"));

if (files.length === 0) {
  console.log("No SVG files found in content/assets/");
  process.exit(0);
}

for (const file of files) {
  const svgPath = join(ASSETS_DIR, file);
  const pngName = basename(file, extname(file)) + ".png";
  const pngPath = join(ASSETS_DIR, pngName);

  const svg = readFileSync(svgPath, "utf-8");

  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "original",
    },
    font: {
      loadSystemFonts: true,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  writeFileSync(pngPath, pngBuffer);

  const sizeKB = (pngBuffer.length / 1024).toFixed(1);
  console.log(`✓ ${file} → ${pngName} (${pngData.width}×${pngData.height}, ${sizeKB} KB)`);
}

console.log(`\nConverted ${files.length} SVG files to PNG.`);
