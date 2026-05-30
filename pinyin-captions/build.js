import esbuild from 'esbuild';
import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'popup'), { recursive: true });
await mkdir(join(dist, 'icons'), { recursive: true });

const shared = {
  bundle: true,
  format: 'iife',
  target: ['chrome114'],
  logLevel: 'info'
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: [join(root, 'content_script.js')],
    outfile: join(dist, 'content_script.js')
  }),
  esbuild.build({
    ...shared,
    entryPoints: [join(root, 'background.js')],
    outfile: join(dist, 'background.js')
  })
]);

await copyFile(join(root, 'manifest.json'), join(dist, 'manifest.json'));
await copyFile(join(root, 'popup', 'popup.html'), join(dist, 'popup', 'popup.html'));
await copyFile(join(root, 'popup', 'popup.js'), join(dist, 'popup', 'popup.js'));
await copyFile(join(root, 'icons', 'icon128.png'), join(dist, 'icons', 'icon128.png'));

const files = await readdir(dist);
console.log(`Pinyin Captions build complete: dist/ (${files.join(', ')})`);
