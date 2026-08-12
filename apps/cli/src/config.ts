import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

/** Static CLI configuration shared by the program factory and the main seam. */
export const CLI_CONFIG = {
    binaryName: 'kk',
    binaryVersion: pkg.version,
} as const;
