# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [0.1.0] - 2026-09-01

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

- `harness.stderr()`, captured from before the handshake. A server that dies
  while starting reports `Connection closed` and nothing else; the reason is on
  stderr, so `startServer` attaches it to the error it throws.

<!-- #endregion changelog -->

[0.1.0]: https://github.com/ni-c/mcp-integration-harness/releases/tag/v0.1.0
