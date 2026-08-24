const esbuild = require('esbuild');
const path = require('path');

async function runBuild() {
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'app', 'main.tsx')],
      bundle: true,
      outfile: path.join(__dirname, 'dist', 'renderer.js'),
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
