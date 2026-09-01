# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/mcp-integration-harness.git && cd mcp-integration-harness
npm install
npm test          # no container is involved; the fixture is a tiny MCP server
npm run build
```

This library has no integration suite of its own, which is only fair to
mention: `test/fixtures/tiny-server.mjs` is a real MCP server spawned as a real
process, so the stdio path, the elicitation path and the token path are all
exercised end to end — there is simply no third-party backend to stand up.

## Expectations

- **Tests.** A behaviour change comes with a test that fails without it. Say so
  in the pull request: "control run with the change reverted — this fails" is
  worth more than a green tick, because a test that cannot fail proves nothing.
  CI runs on Node 22 and 24, plus oxlint, prettier, `npm audit` and CodeQL.
- **Coverage gates are not lowered.** Answer a drop with tests. If a line
  genuinely cannot be reached, say why in `vitest.config.ts` rather than chasing
  the number with a cast.
- **The loopback guard is load-bearing.** A change anywhere near
  `src/loopback.ts` needs a test that shows a non-local URL still throws. The
  suites this library serves call every tool a server has, deletes included, on
  machines that also have production instances configured.
- **Comments explain constraints the code cannot show** — the reason a thing is
  written the awkward way, not what the next line does.
- **No new runtime dependencies** without a very good reason. The one that is
  here, `mcp-internal-hosts`, exists so the loopback check is numeric rather
  than a string comparison.
- Run `npm run lint` before pushing: it covers both oxlint and prettier, and
  prettier also validates the YAML, JSON and Markdown.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/mcp-integration-harness/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/mcp-integration-harness/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/mcp-integration-harness/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
