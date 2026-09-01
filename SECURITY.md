# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/mcp-integration-harness/security/advisories/new).
Do not open a public issue for an unpatched vulnerability.

Only the latest release and the current `main` branch receive security fixes.

## Trust model

This is test infrastructure. It belongs in `devDependencies` and must never
appear in a server's runtime tree — it exists to spawn processes and call every
tool they have, which is not a capability any deployed server should carry.

The risk it manages is not an attacker. It is a **misdirected run**: a suite
that calls every tool, deletes included, executed on a machine that also has
real instances configured — an internal wiki, a CI server, a VPN endpoint.
Three properties address that, and all three are guard rails rather than
guarantees.

**Backend URLs must be loopback.** `assertLoopback` throws — never skips — on
anything else, and `waitForHttp` calls it before its first request, so a
misconfigured URL is not contacted even once. Classification is numeric, via
`mcp-internal-hosts`, so `[::ffff:127.0.0.1]` and `localhost.` are recognised
and `127.example.com` is not mistaken for one.

**Nothing is inherited from the environment.** `startServer` passes `PATH` and
the variables given to it. A leftover `WIKIJS_URL` in a shell cannot reach the
spawned server.

**Compose files bind `127.0.0.1` only.** Not enforceable from here — it is a
convention for the suites that use this library, and it is worth stating
because the backends these suites start run with default credentials.

## What is deliberately not defended against

- **A suite that does not use the guard.** `assertLoopback` protects the URLs
  it is handed. A test that constructs a URL and passes it straight to `fetch`
  is outside this library entirely. `waitForHttp` and `startServer` are where
  the check is unavoidable; use them.
- **A backend that is not throwaway.** Loopback and disposable are not the same
  property, and only the first is checkable. If a real instance runs on this
  machine's loopback interface, the guard will let it through.
- **Anything the server itself does with its credentials.** The harness hands
  over the environment a compose stack produced; what the server then reaches
  is the server's business, and belongs in that server's own SSRF defences.
