// Two-process lease race probe: acquire the same profile, hold briefly, report the outcome.
// Run by profile-lease.test.ts in a separate `bun` process — not a test file itself.
import { acquireProfileLease } from '../../src/profile-lease';

const [profileDir, leaseRoot] = process.argv.slice(2);
try {
    await acquireProfileLease(profileDir as string, { leaseRoot });
    await Bun.sleep(250);
    process.stdout.write('acquired\n');
} catch {
    process.stdout.write('busy\n');
}
