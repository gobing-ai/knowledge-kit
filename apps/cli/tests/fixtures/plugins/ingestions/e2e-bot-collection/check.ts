// 0346 E2E fixture probe: the declared `browserSession` requires a `check` entry that owns
// login/check/open. This fixture never logs in — the E2E script seeds the profile — so the probe
// only reports readiness, in the shape ADR-032 expects.
console.log(JSON.stringify({ ok: true, adapter: 'e2e-bot-collection' }));
