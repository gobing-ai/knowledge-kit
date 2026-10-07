// E93 fixture probe: check → verified; login → exit 7 (code-propagation fixture).
const sub = process.argv[2];
if (sub === 'login') process.exit(7);
console.log(JSON.stringify({ status: 'verified', profileDir: '/tmp/e2e-verified-profile', detail: 'session live' }));
