import { describe, expect, it } from 'vitest';

import { assertLoopback } from '../src/loopback.js';

describe('the loopback guard', () => {
  it.each([
    'http://127.0.0.1:3000',
    'http://localhost:8080/api',
    'http://localhost.:8080',
    'http://[::1]:3000',
    // URL canonicalises this to [::ffff:7f00:1] before the guard ever sees it,
    // which is why the check is numeric rather than a string comparison.
    'http://[::ffff:127.0.0.1]:3000',
    'https://127.0.0.2:9000',
  ])('lets %s through', (url) => {
    expect(() => assertLoopback(url)).not.toThrow();
  });

  it('refuses a real host that exists on this machine’s network', () => {
    // Not a hypothetical: this machine has MCP servers configured against a
    // wiki people write in. An integration suite calls every tool, deletes
    // included. If this test ever goes green by being deleted, that is the
    // accident it was written to prevent.
    expect(() => assertLoopback('https://wiki.roamsys.com')).toThrow(
      /refusing to run against wiki\.roamsys\.com/
    );
  });

  it.each([
    'https://api.hetzner.com',
    'http://10.10.1.2:3000',
    'http://192.168.1.10',
    'http://169.254.169.254/latest/meta-data/',
    // A prefix check on "127." would wave this one through, and anybody can
    // register it.
    'http://127.example.com',
  ])('refuses %s', (url) => {
    expect(() => assertLoopback(url)).toThrow(/refusing to run against/);
  });

  it('says what it wants when handed something that is not a URL', () => {
    expect(() => assertLoopback('')).toThrow(/not a URL/);
    expect(() => assertLoopback('nonsense')).toThrow(/not a URL/);
  });

  it('names the missing scheme instead of blaming an empty hostname', () => {
    // `new URL('localhost:3000')` succeeds — protocol `localhost:`, no host —
    // so the loopback check alone would reject it with a message containing a
    // blank where the hostname should be.
    expect(() => assertLoopback('localhost:3000')).toThrow(
      /not an http\(s\) URL/
    );
    expect(() => assertLoopback('file:///etc/passwd')).toThrow(
      /not an http\(s\) URL/
    );
  });

  it('throws rather than skipping, so a misdirected run cannot look green', () => {
    // The distinction the message exists for: a skipped test reports "nothing
    // to do here", which is the wrong sentence when the reason is "this was
    // pointed at production".
    expect(() => assertLoopback('https://wiki.roamsys.com')).toThrow(
      /may only ever talk to a throwaway backend on this machine/
    );
  });
});
