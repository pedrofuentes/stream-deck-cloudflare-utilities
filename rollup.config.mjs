/**
 * Rollup bundler configuration.
 *
 * Source assets live in `plugin/` (tracked in git).
 * The build copies them into `release/<sdPlugin>/` and compiles TS there.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const isWatch = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.pedrofuentes.cloudflare-utilities.sdPlugin";
const sourceDir = "plugin";
const releaseDir = path.join("release", sdPlugin);

/**
 * Recursively copy a directory.
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Rollup plugin that copies source assets from `plugin/` into the release dir.
 */
function copyPluginAssets() {
  return {
    name: "copy-plugin-assets",
    buildStart() {
      this.addWatchFile(`${sourceDir}/manifest.json`);
    },
    generateBundle() {
      copyDirSync(sourceDir, releaseDir);
    },
  };
}

/**
 * @type {import("rollup").RollupOptions}
 */
const config = {
  input: "src/plugin.ts",
  output: {
    file: `${releaseDir}/bin/plugin.js`,
    format: "esm",
    sourcemap: isWatch,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
      return url.pathToFileURL(
        path.resolve(path.dirname(sourcemapPath), relativeSourcePath)
      ).href;
    },
  },
  plugins: [
    copyPluginAssets(),
    typescript({
      mapRoot: isWatch ? "./" : undefined,
    }),
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true,
    }),
    commonjs(),
  ],
  external: ["node:*"],
};

export default config;
