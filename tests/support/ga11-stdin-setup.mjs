// UDG-SPIKE-001 slice 30 — GA-11 stdin netrc relay (global setup).
//
// WHY: a Playwright TEST WORKER does not inherit the dispatched command's stdin, so the
// `ga11-session` cell alone could never read the operator's piped, root-owned netrc. The MAIN
// process (where global setup runs) can: it reads fd 0 exactly once, hands the bytes to the
// gated cell through the child environment (base64, in-process only — never argv, never a file;
// the cell deletes the variable the moment it decodes), and erases nothing else.
//
// It is COMPLETELY INERT unless UDG_GA11_SESSION=1: every ordinary suite, CI lane and cell sees
// a no-op setup. It opens no socket, reads no file, logs nothing, and fails closed: an unreadable
// stdin stays "no netrc arrived", which the cell names as its own admission failure.
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import process from 'node:process';

export default async function ga11StdinSetup() {
  if (process.env['UDG_GA11_SESSION'] !== '1') return undefined;
  if (process.stdin.isTTY === true) return undefined; // nothing piped: the cell will name the missing credential itself
  try {
    const text = readFileSync(0, 'utf8');
    if (text !== '') process.env['UDG_GA11_NETRC_B64'] = Buffer.from(text, 'utf8').toString('base64');
  } catch {
    // fail closed: no relay, the cell refuses with a named admission error
  }
  return undefined;
}
