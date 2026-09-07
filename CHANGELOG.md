# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [0.4.1] - 2026-09-07

### Changed

- Source maps are no longer published in the npm tarball. Node reads them only
  under `--enable-source-maps`, which nothing here sets, and the maps pointed at
  a `src/` this package does not ship — so a stack trace under that flag named a
  file nobody could open. `dist/**/*.js` is unchanged; the package is about a
  fifth smaller.

### Security

- **mcp-approval 0.8.2.** A sealed dialog answer is single-use since 0.8.1: the same `requestState` presented again within its lifetime used to be accepted again, and with a resource key that is the same every time — a whole stream, a fixed set of targets — every replay landed. npm users on `^0.8.0` already had the fix; the Docker image is built from the lockfile and carried 0.8.0 until this release.

## [0.4.0] - 2026-09-03

### Added

- `expectPortableToolSchemas` and `schemaPortability`: a lint over the schemas a
  server advertises, for four spellings that are legal JSON Schema and still get
  a tool refused or silently stripped by some MCP clients — `{}` in a schema
  position (what zod writes for `looseObject`, `catchall` and `z.unknown()`), a
  bare `true`/`false` where a schema object belongs, `type` as an array, and a
  `$ref` that leaves the document.

  No exemption map, unlike the coverage checks. Those excuse what a backend
  cannot provide; here every finding has an equivalent spelling that says the
  same thing to a validator, so a reason could only ever read "not fixed yet".

  It runs against the schema as it goes on the wire, which is the only place it
  can: zod emitted `anyOf` for a nullable string up to 4.4 and a `type` array
  from 4.5 on, so identical source is portable or not depending on a patch
  release of a dependency.

## [0.3.0] - 2026-09-02

### Added

- `expectEveryToolDeclaresOutputSchema` and `outputSchemaCoverage`: the same
  three-way check as the tool-coverage gate, applied to what a server says it
  returns. A tool that declares no `outputSchema` fails unless it carries a
  written reason, and a schema whose root is not an object fails outright —
  a 2025-era client is served that schema rewritten as `{result: …}`, so the
  same tool would answer in two shapes depending on who asked.

  It checks presence, not conformance, on purpose: the SDK validates
  `structuredContent` against the advertised schema server-side, so a wrong
  schema already fails the call and every ordinary assertion in a suite is
  a schema-against-reality check.

- `ToolResult.structuredContent`, so a suite can assert on the machine-readable
  half of an answer instead of parsing it back out of the text block.

### Fixed

- `confirmed()` no longer asserts anything about the first half's `isError`.
  From `mcp-approval` 0.8.0 the fallback prompt is an error result — it has to
  be, or a guarded tool that declares an `outputSchema` cannot answer with it at
  all — and asserting either way would tie this library to one version of that
  one. `tokenOf` decides whether the call went as intended, and its message
  names the mistake that actually causes this (calling `confirmed()` on a
  harness started **with** `elicit`).

## [0.2.0] - 2026-09-02

### Fixed

- The harness now fails a run when the server breaks the stdio framing. A line
  that parses as JSON but is not a JSON-RPC message reaches the client's
  `onerror`, and with no listener it was discarded — so a stray
  `console.log(JSON.stringify(x))` in a server or one of its dependencies left
  every suite in this family green while the framing this library exists to
  exercise was broken. Also catches era mismatches, unknown message ids and
  dropped inbound requests. Checked after each call, so the failure names the
  tool it happened on.

  The remaining gap is stated in the README rather than papered over: a line
  that is not JSON **at all** is swallowed inside the SDK's read buffer, below
  any hook a client can install. Without a trailing newline it corrupts the next
  real message instead, which surfaces as a request timeout — the timeout
  message now says to suspect stdout.

- `timeoutSeconds` is read. It was declared, documented as "default 30", and
  never passed to `connect`, so the SDK's own 60 seconds applied in every case.
  A repo with a slow-starting backend that raised it kept failing at 60; one
  that lowered it kept waiting a minute per attempt.

- The names `StdioClientTransport` merges in underneath the given environment —
  `HOME`, `LOGNAME`, `SHELL`, `TERM`, `USER`, and the `APPDATA` family on
  Windows — are now blanked explicitly, with `HOME` pointed at a temporary
  directory. "Nothing is inherited" was the documented property and the reason
  to trust the harness with destructive integration runs; it needed enforcing
  rather than merely not being asked for. The test that appeared to prove it
  used a variable that is not on the SDK's inherit list, so it passed either
  way.

### Added

- `expectError` accepts a string or a `RegExp` as well as `true`. `true` alone
  asserts that _something_ failed, which is weaker than it reads: a renamed
  parameter makes the schema reject the call, and a guard test written that way
  stays green while the guard it names is never reached. Where the refusal is
  the point of the test, name the reason.

## [0.1.0] - 2026-09-02

First release. Extracted from four incompatible attempts at the same thing — a
Python bootstrap plus three hand-rolled `.mjs` smoke scripts spread across four
of the seventeen servers in this family, none of them wired into CI, and one of
them calling all 62 tools of its server while always exiting 0.

### Added

- `startServer` — spawns the **built** entry point over real stdio, so
  `src/index.ts`, `loadConfig` against a real environment, the transport's
  framing and elicitation across a process boundary are all on the path. None
  of the four are reachable from an `InMemoryTransport` test.

  The child's environment is `PATH` plus what was passed, and nothing else. A
  variable left in a shell cannot redirect a run that calls every delete the
  server has.

- `expectEveryToolExercised` — fails unless every tool was called or excused,
  where an excuse is prose a person wrote. Fails in three directions: a tool
  neither called nor excused; an excused tool called after all, whose reason is
  now false; and a reason naming a tool that no longer exists. All three are
  reported at once.

- `assertLoopback` — refuses any backend URL that is not on this machine, with
  a throw rather than a skip, because a skipped test reads as "nothing to do
  here" precisely when the reason is "this was pointed at production". Hosts
  are classified numerically by `mcp-internal-hosts`, so `[::ffff:127.0.0.1]`
  and `localhost.` count as loopback and `127.example.com` does not.

- `waitForHttp` — polls a backend until it is ready and reports what the last
  attempt actually got. `docker compose up --wait` only covers images that
  declare a healthcheck, and the usual substitute is a fixed `sleep`, whose
  failure mode is the first tool call returning `ECONNREFUSED` — which reads
  like a bug in the tool.

- `waitForTcp` — the same for a backend that does not speak HTTP. `fetch`
  against an IMAP or SMTP port does not resolve: undici cannot parse the
  greeting as an HTTP response, so it rejects, and `waitForHttp` would report a
  timeout for a server that was ready in a second. Optionally waits for the
  greeting itself rather than only the connection, because Docker publishes a
  port before the process inside is listening on it — and its failure message
  names that case, which is the one that costs the most time.

- `harness.raw`, for a tool whose answer is an image or a resource rather than
  text — a cover, a QR code, an uploaded asset. Without it the only way to see
  the parts is `harness.client`, which skips the coverage bookkeeping, so the
  tool has to be added to `called` by hand. That is exactly the sort of thing
  that stops being done, and it quietly weakens the one assertion this library
  exists for.

- `harness.stderr()`, captured from before the handshake. A server that dies
  while starting reports `Connection closed` and nothing else; the reason is on
  stderr, so `startServer` attaches it to the error it throws — and so does
  every later call, because a server that dies halfway through a suite reports
  `Not connected` on the next tool call and names neither the tool nor the
  reason.

<!-- #endregion changelog -->

[0.4.1]: https://github.com/ni-c/mcp-integration-harness/releases/tag/v0.4.1
[0.1.0]: https://github.com/ni-c/mcp-integration-harness/releases/tag/v0.1.0
