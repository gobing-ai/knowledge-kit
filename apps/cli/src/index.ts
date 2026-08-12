#!/usr/bin/env bun
import { main } from './main';

if (import.meta.main) {
    process.exit(await main());
}
