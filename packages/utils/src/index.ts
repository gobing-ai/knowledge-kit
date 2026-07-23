/** Add two numbers. */
export function add(a: number, b: number): number {
    return a + b;
}

// Re-export zod so every workspace package gets it through utils.
// Zod 4: ZodSchema was removed; ZodType is the generic schema type.
export type { ZodType } from 'zod';
export { z } from 'zod';

export { logger } from './logger';
