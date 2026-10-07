const args = process.argv.slice(3);
const token = 'sk-live-e2e0123456789abcdef';
console.log(`probe noise ${token}`);
console.error(`stderr leak ${token}`);
console.log(JSON.stringify({ status: 'verified', detail: `headed=${args.includes('--headed')}` }));
