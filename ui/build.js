const esbuild = require('esbuild');

async function runBuild() {
  try {
    await esbuild.build({
      entryPoints: ['app/main.tsx'],
      bundle: true,
      outfile: 'dist/renderer.js',
      format: 'iife',
      target: ['chrome120'],
      platform: 'browser',
      jsx: 'automatic',
      loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.css': 'css'
      }
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

runBuild();
