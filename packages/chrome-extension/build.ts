/**
 * esbuild script for the Chrome extension.
 *
 * Bundles background.ts and popup.ts (which import @funny/funny-client)
 * into self-contained JS files that Chrome can load directly.
 *
 * content.js and page-bridge.js remain as plain JS (no server imports).
 */

import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const buildOptions: esbuild.BuildOptions = {
  entryPoints: [
    'src/background.ts',
    'src/popup.ts',
  ],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('Build complete.');
}
