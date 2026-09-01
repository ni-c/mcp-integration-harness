# mcp-integration-harness

[![npm version](https://img.shields.io/npm/v/mcp-integration-harness)](https://www.npmjs.com/package/mcp-integration-harness)
[![node](https://img.shields.io/node/v/mcp-integration-harness)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/mcp-integration-harness)](LICENSE)

Run your built [Model Context Protocol](https://modelcontextprotocol.io) server
as a real process, against a real backend in Docker, and fail the build unless
**every** tool was either exercised or excused in writing.

```ts
const harness = await startServer({
  env: { WIKIJS_URL: backendUrl, WIKIJS_TOKEN: token },
  elicit: 'accept',
});

const page = await harness.call('create_page', {
  path: 'test',
  content: '# hi',
});
await harness.call('get_page', { path: 'test' });
await harness.confirmed('delete_page', { id });

it('exercises every tool in the catalogue', () => {
  expectEveryToolExercised(harness, ALL_TOOLS, {
    get_page_conflict: 'needs two concurrent edits; see the conflict test',
    reset_user_password: 'needs a local user and a working mail transport',
  });
});
```

## Why not the in-memory transport you already have

Because it answers a different question. A unit suite links server to client
with `InMemoryTransport` and replaces `fetch` underneath, which tests whether
the server does what you believe the remote API does — not whether the API does
it. Every genuinely surprising bug in this family was found by hand against a
running instance: a `limit` parameter that counts join rows rather than pages,
an empty `files` entry that deletes, a `filter` that is silently ignored. A
stub cannot find those, because the stub encodes the same belief the code does.

Four things are additionally untouched by any in-process test: `src/index.ts`,
`loadConfig` reading a real environment, the stdio transport's framing, and
elicitation across a **process boundary**. This spawns the built artifact, so
all four are on the path.

## `expectEveryToolExercised`

The part worth copying even if you write the rest yourself.

`skipped` is a `Record<tool, reason>`, never a `string[]`. A bare list lets a
tool leave the suite by adding six characters, and nothing afterwards
distinguishes a deliberate omission from a forgotten one. A reason has to be
written by a person — a small cost, in exactly the place a small cost is
useful.

It fails in three directions, not one:

1. **A tool neither called nor excused.** The gap everyone expects.
2. **An excused tool that _was_ called.** The reason is now false, and a false
   reason is worse than none: the next person reads it and believes the tool
   cannot be tested.
3. **An excused tool that no longer exists.** Renamed or removed, its excuse
   left behind, quietly making the exception list look longer than the real one.

All three are reported together, so a fourteen-repository rollout is one
afternoon rather than fourteen CI rounds.

## `assertLoopback`

The guard that matters more than the tests it protects.

An integration suite calls every tool, deletes included, and the machine it is
written on is usually the same machine that has the _real_ servers configured —
a wiki people write in, a CI instance that builds things, a VPN. One inherited
`WIKIJS_URL` is all it takes.

So: a **hard throw**, never a skip. A skipped test reports "nothing to do
here", which is the wrong sentence when the reason is "this was pointed at
production". Hosts are compared numerically via
[`mcp-internal-hosts`](https://www.npmjs.com/package/mcp-internal-hosts), so
`[::ffff:127.0.0.1]` and `localhost.` count and `127.example.com` — a hostname
anybody can register — does not.

`startServer` is the same idea as a property: the child gets `PATH` and the
variables you passed. Nothing is inherited, so nothing can be inherited by
accident.

## API

| Export                     | What it does                                                                    |
| -------------------------- | ------------------------------------------------------------------------------- |
| `startServer(options)`     | Spawns `dist/index.js` over real stdio and returns a `LiveHarness`              |
| `harness.call(name, args)` | Calls a tool, records it for coverage, returns the joined text parts            |
| `harness.confirmed(…)`     | Drives **both halves** of the two-call token, for the no-dialog fallback path   |
| `harness.prompts`          | Every message the server put in front of the user, in order                     |
| `harness.stderr()`         | Everything the server wrote to stderr, including before the handshake completed |
| `expectEveryToolExercised` | The three-way coverage assertion above                                          |
| `toolCoverage`             | The same comparison without asserting, for printing the numbers                 |
| `assertLoopback(url)`      | Throws unless the URL is on this machine                                        |
| `waitForHttp(url, opts)`   | Polls until an HTTP backend is ready, and says what the last attempt got        |
| `waitForTcp(host, port)`   | The same for a backend that is not HTTP — IMAP, SMTP — optionally on a greeting |

`elicit: 'accept' | 'decline' | 'cancel'` makes the harness declare the
elicitation capability and answer the dialog, which is the path a real client
takes. **Omitting** it declares no capability at all, which is what makes a
guarded tool fall back to the token — so `confirmed()` only works on a harness
started without `elicit`, and says so when it does not.

## Requirements

Node 22 or newer, and `@modelcontextprotocol/client` 2.x as a peer. Both belong
in `devDependencies`: this is test infrastructure and has no business in a
server's runtime tree.

## Related

- [`mcp-approval`](https://www.npmjs.com/package/mcp-approval) — the
  human-in-the-loop guard whose two paths this drives
- [`mcp-internal-hosts`](https://www.npmjs.com/package/mcp-internal-hosts) —
  the SSRF host classifier the loopback guard is built on

## Licence

MIT
