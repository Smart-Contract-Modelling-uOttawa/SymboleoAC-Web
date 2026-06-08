// Fire N /generate requests; expect the first RATE_MAX to pass, the rest 429.
const base = process.argv[2] ?? 'http://localhost:3031';
const n = Number(process.argv[3] ?? 5);
const src = 'Domain d\n  X isAn Asset;\nendDomain\nContract C (p : String)\n  Obligations\nendContract';
const statuses = [];
for (let i = 0; i < n; i++) {
  const r = await fetch(`${base}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: src }),
  });
  statuses.push(r.status);
}
console.log('statuses:', statuses.join(', '));
const got429 = statuses.includes(429);
console.log(got429 ? 'OK: rate limit kicked in (429 present)' : 'FAIL: no 429 seen');
process.exit(got429 ? 0 : 1);
