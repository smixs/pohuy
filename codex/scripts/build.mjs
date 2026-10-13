import { build } from 'esbuild';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  entryPoints: [directory + 'src/controller.ts', directory + 'src/server.ts'],
  outdir: directory + 'dist', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22', metafile: true, minify: false, charset: 'utf8',
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
await mkdir(directory + 'dist', { recursive: true });
const packages = [...new Set(Object.keys(result.metafile.inputs).flatMap(input => {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
  return match ? [match[1]] : [];
}))].sort();
const licenses = [];
for (const name of packages) {
  const base = new URL(`../../node_modules/${name}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', base), 'utf8'));
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'license', 'license.md']) {
    try { license = await readFile(new URL(filename, base), 'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // The 4.1.1 npm tarball omits LICENSE.md. Use the source commit recorded by npm.
  if (!license && name === '@cfworker/json-schema' && manifest.version === '4.1.1') {
    const response = await fetch('https://raw.githubusercontent.com/cfworker/cfworker/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`License download failed: ${name}, HTTP ${response.status}`);
    license = await response.text();
    if (createHash('sha256').update(license).digest('hex') !== '376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094') {
      throw new Error(`License checksum mismatch: ${name}`);
    }
  }
  if (!license) throw new Error(`Missing license: ${name}`);
  licenses.push(`${name} ${manifest.version}\n${license}`);
}
await writeFile(directory + 'dist/THIRD_PARTY_LICENSES.txt', licenses.join('\n\n'));

const assets = new URL('../../assets/', import.meta.url);
const icon = await sharp(fileURLToPath(new URL('../../docs/assets/pohuy.webp', import.meta.url)))
  .autoOrient()
  .resize(512, 512, { fit: 'cover', position: 'centre' })
  .png()
  .toBuffer();
await mkdir(assets, { recursive: true });
await writeFile(new URL('icon.png', assets), icon);
await writeFile(new URL('icon.svg', assets), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <image width="512" height="512" href="data:image/png;base64,${icon.toString('base64')}"/>
</svg>
`);
