// Export the approved U glyph on a white rounded square with transparent corners.
// Pass a Sharp package path when using the bundled desktop dependency runtime.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] || 'sharp');
const root = new URL('../public/', import.meta.url);
const symbol = await readFile(new URL('assets/brand/usung-u-symbol.svg', root), 'utf8');
const glyph = symbol.match(/<g[\s\S]*<\/g>/)[0].replace('fill="#EEEDE7"', 'fill="#151616"');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" ry="8" fill="#FFFFFF"/>${glyph}</svg>\n`;
await writeFile(new URL('assets/brand/usung-u-symbol.svg', root), icon);
await writeFile(new URL('assets/brand/usung-icon-white.svg', root), icon);
await writeFile(new URL('favicon.svg', root), icon);
for (const [name, size] of [['favicon-32.png',32],['favicon.png',48],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512]]) {
  await sharp(Buffer.from(icon), { density: 384 }).resize(size,size).ensureAlpha().png().toFile(new URL(name, root).pathname);
}
// Legacy browsers request this path even when the page specifies PNG icons.
const png = await readFile(new URL('favicon-32.png', root));
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);
ico[6]=32;ico[7]=32;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);
ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
await writeFile(new URL('favicon.ico', root), Buffer.concat([ico,png]));
console.log('Exported rounded white PNG icons from the approved U glyph.');
