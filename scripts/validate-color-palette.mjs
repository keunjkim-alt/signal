import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

export async function validateColorPalette() {
  const [lockSource, css, html] = await Promise.all([
    readFile(new URL('config/viimsignal-color-palette.lock.json', root), 'utf8'),
    readFile(new URL('color-palette.css', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
  ]);
  const lock = JSON.parse(lockSource);
  if (lock.locked !== true) throw new Error('VIIMsignal color palette must remain locked.');
  for (const [token, value] of Object.entries(lock.tokens)) {
    const declaration = `--viim-${token}: ${String(value).toUpperCase()};`;
    if (!css.includes(declaration)) throw new Error(`Locked palette token mismatch: ${token}`);
  }
  const blueThemeIndex = html.indexOf('blue-theme.css');
  const paletteIndex = html.indexOf('color-palette.css');
  const closingHeadIndex = html.indexOf('</head>');
  if (paletteIndex < 0 || paletteIndex < blueThemeIndex || paletteIndex > closingHeadIndex) {
    throw new Error('color-palette.css must be the final application stylesheet.');
  }
  return lock;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href;
if (invokedDirectly) {
  const lock = await validateColorPalette();
  console.log(`Validated locked palette ${lock.version}`);
}
