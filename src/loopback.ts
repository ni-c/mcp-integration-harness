import { internalHostKind } from 'mcp-internal-hosts';

/**
 * Refuses any backend URL that is not on this machine.
 *
 * This is the one guard that matters more than the tests it protects. An
 * integration suite calls every tool, including the deletes, and the machine it
 * is written on is usually the machine that also has the *real* servers
 * configured — a wiki people write in, a CI instance that builds things, a VPN.
 * Getting `WIKIJS_URL` from the ambient environment once is all it takes.
 *
 * So: a hard throw, never a skip. A skipped test reads as "nothing to do here",
 * which is exactly the wrong report when the reason is "this was pointed at
 * production". The suite must stop and say so.
 *
 * `internalHostKind` rather than a string comparison, so every spelling of the
 * same address counts: `[::ffff:127.0.0.1]`, which `URL` canonicalises to
 * `[::ffff:7f00:1]` before anything else sees it, and `localhost.` with its root
 * label. A prefix check on `127.` would also call `127.example.com` local, which
 * is a public hostname anyone can register.
 */
export function assertLoopback(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `mcp-integration-harness: refusing to run against "${url}" — not a URL. ` +
        'The backend URL must come from the throwaway compose stack.'
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // `new URL('localhost:3000')` succeeds: protocol `localhost:`, hostname
    // empty. Without this branch the next check rejects it for having no host,
    // and the message reads "refusing to run against " with a hole where the
    // hostname should be — true, but no help at all to whoever forgot `http://`.
    throw new Error(
      `mcp-integration-harness: refusing to run against "${url}" — not an ` +
        'http(s) URL. A scheme-less "localhost:3000" parses as a URL whose ' +
        'protocol is "localhost:", which is not the same thing as a backend.'
    );
  }
  if (internalHostKind(parsed.hostname) !== 'loopback') {
    throw new Error(
      `mcp-integration-harness: refusing to run against ${parsed.hostname} — ` +
        'the integration suite calls every tool, deletes included, and may only ' +
        'ever talk to a throwaway backend on this machine. Expected a loopback ' +
        'host; got a URL that resolves somewhere else.'
    );
  }
}
