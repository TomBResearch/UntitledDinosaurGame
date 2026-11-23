/**
 * UDG-SPIKE-001 slice 30 (review) — GA-11 run.log HOST-REDACTION FILTER (test-only).
 *
 * The dispatched session command pipes its stdout through this filter BEFORE `tee run.log`, so
 * the operator's log carries no endpoint value even when the SDK's own console noise names the
 * socket URL. Values are derived from EXPLICIT env (UDG_GA11_ENDPOINT, same ingress as the cell);
 * credentials never reach stdout at all, so nothing here can print one. Fail-closed: with no
 * endpoint in env the filter REFUSES (exit 2) rather than pass host strings through unnoticed.
 * It is a stateless stdin→stdout byte pump: no files, no listeners, nothing to retire. Redaction
 * here is discipline, not access control (handoff §4 binds the values exactly as elsewhere).
 */

import { ga11EndpointGuard, ga11LogFilterValues, makeGa11Redactor } from './ga11-session.js';

// Node ambient globals (types:["node"]) — the same posture as staging-probe.ts in this package.
const main = async (): Promise<number> => {
  const raw = process.env['UDG_GA11_ENDPOINT'] ?? '';
  const guarded = ga11EndpointGuard(raw, { allowLoopbackInsecure: true });
  if (guarded.ok !== true) {
    process.stderr.write(`ga11-log-filter: refusing (${guarded.error}) — run it only with UDG_GA11_ENDPOINT set, between the session and tee\n`);
    return 2;
  }
  const redact = makeGa11Redactor(ga11LogFilterValues(guarded));
  process.stdin.setEncoding('utf8');
  let carry = '';
  for await (const chunk of process.stdin) {
    const text = carry + String(chunk);
    const parts = text.split('\n');
    carry = parts.pop() ?? ''; // never split a value across the line boundary
    const out = parts.map((line) => redact(line)).join('\n');
    if (out !== '') process.stdout.write(`${out}\n`);
  }
  if (carry !== '') process.stdout.write(`${redact(carry)}\n`);
  return 0;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
