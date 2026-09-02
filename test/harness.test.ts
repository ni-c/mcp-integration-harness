import { describe, expect, it } from 'vitest';

import { startServer, tokenOf } from '../src/harness.js';

const TINY = 'test/fixtures/tiny-server.mjs';
const ALL_TOOLS = [
  'say_hello',
  'delete_thing',
  'mixed_content',
  'always_fails',
] as const;

describe('driving a server over real stdio', () => {
  it('spawns the entry point and talks to it', async () => {
    const harness = await startServer({
      entry: TINY,
      env: { TINY_GREETING: 'world' },
    });
    expect(await harness.call('say_hello')).toBe('hello world');
    expect(
      (await harness.client.listTools()).tools.map((t) => t.name).sort()
    ).toEqual([...ALL_TOOLS].sort());
    await harness.close();
  });

  it('gives the server nothing it was not handed', async () => {
    // The guard that matters most, as a property rather than a promise: a
    // variable in this process does not reach the child. If it did, a stray
    // WIKIJS_URL in a shell could redirect an integration run — deletes and
    // all — at whatever it names.
    process.env.TINY_GREETING = 'from-the-ambient-environment';
    try {
      const harness = await startServer({ entry: TINY, env: {} });
      expect(await harness.call('say_hello')).toBe('hello (unset)');
      await harness.close();
    } finally {
      delete process.env.TINY_GREETING;
    }
  });

  it('blanks the names the SDK would otherwise inherit', async () => {
    // "Nothing is inherited" needed enforcing, not just not asking for it:
    // StdioClientTransport merges getDefaultEnvironment() *underneath* whatever
    // it is handed, and that carries HOME, LOGNAME, SHELL, TERM and USER
    // through from the parent. A server whose dependency reads ~/.netrc or a
    // credential file under os.homedir() would run the suite as the developer.
    //
    // The previous test cannot see this: TINY_GREETING is not on that list, so
    // it passed whether nothing was inherited or those five were.
    const harness = await startServer({
      entry: TINY,
      env: { TINY_REPORT_ENV: '1' },
    });
    await harness.call('say_hello');
    const seen = harness.stderr();
    expect(seen).toContain('USER=(unset)');
    expect(seen).toContain('SHELL=(unset)');
    // HOME is pointed at a temp directory rather than blanked: an empty HOME
    // breaks tools in a way that reads like a bug in the server under test.
    expect(seen).toMatch(/HOME=(?!\(unset\))\S/);
    expect(seen).not.toContain(`HOME=${process.env.HOME ?? '/nonexistent'} `);
    await harness.close();
  });

  it('fails the run when the server writes to stdout', async () => {
    // stdout belongs to the transport. A line that parses as JSON but is not a
    // JSON-RPC message — the shape a stray console.log(JSON.stringify(x))
    // produces — reaches the client's onerror and used to be discarded, which
    // left every suite in this family green while the framing this library
    // exists to exercise was broken.
    const harness = await startServer({
      entry: TINY,
      env: { TINY_GREETING: 'noisy', TINY_POLLUTE_STDOUT: '1' },
    });
    await expect(harness.call('say_hello')).rejects.toThrow(
      /broke the stdio framing.*console\.log/s
    );
    await harness.close().catch(() => undefined);
  });

  it('keeps stderr, including what was written before the handshake', async () => {
    const harness = await startServer({
      entry: TINY,
      env: { TINY_GREETING: 'logged' },
    });
    await harness.call('say_hello');
    // Written by the fixture at module scope, i.e. before connect() returns.
    // A listener attached after the handshake misses it, which is exactly when
    // it is needed: a server that refuses to start says why here.
    expect(harness.stderr()).toContain('starting with greeting=logged');
    await harness.close();
  });

  it('says what the server wrote when the server is gone', async () => {
    // The other moment a server can die. A crash halfway through a suite
    // surfaces on the *next* call as a bare "Not connected", which names
    // neither the tool nor the reason — while the reason is in the stderr the
    // harness has been collecting since it started. Closing the transport is
    // the reproducible version of that: the client is disconnected either way.
    const harness = await startServer({
      entry: TINY,
      env: { TINY_GREETING: 'logged' },
    });
    await harness.close();

    await expect(harness.call('say_hello')).rejects.toThrow(
      /calling say_hello failed at the transport[\s\S]*starting with greeting=logged/
    );
  });

  it('says so when a dead server left nothing behind either', async () => {
    // The unhelpful case, spelled out: no stderr at all. "(nothing)" is a
    // finding — it says the server did not fail, it vanished — where an empty
    // line would read like the message was cut off.
    const harness = await startServer({
      entry: TINY,
      env: { TINY_SILENT: '1' },
    });
    await harness.close();

    await expect(harness.call('say_hello')).rejects.toThrow(
      /stderr so far:\n\(nothing\)/
    );
  });

  it('hands back the whole result when the parts are the point', async () => {
    // A cover, a QR code, an uploaded asset: tools whose answer is not text.
    // Reaching for `harness.client` instead would skip the coverage
    // bookkeeping, and the tool would then have to be added to `called` by
    // hand — which is exactly the sort of thing that stops being done.
    const harness = await startServer({ entry: TINY, env: {} });
    const result = await harness.raw('mixed_content');
    expect(result.content?.map((part) => part.type)).toEqual([
      'text',
      'image',
      'text',
    ]);
    expect(harness.called.has('mixed_content')).toBe(true);
    await harness.close();
  });

  it('applies expectError on the raw path too', async () => {
    const harness = await startServer({ entry: TINY, env: {} });
    const failed = await harness.raw('always_fails', {}, { expectError: true });
    expect(failed.isError).toBe(true);
    await expect(harness.raw('always_fails')).rejects.toThrow(
      /always_fails failed: no/
    );
    await harness.close();
  });

  it('joins the text parts and drops the rest', async () => {
    // Several servers in the family return an image alongside their text —
    // an uploaded asset, a QR code. Stringifying a base64 blob into the value
    // an assertion matches against would make every such test unreadable.
    const harness = await startServer({ entry: TINY, env: {} });
    expect(await harness.call('mixed_content')).toBe(
      'the text part\nand another'
    );
    await harness.close();
  });

  it('runs the server from a given directory', async () => {
    const harness = await startServer({
      entry: 'fixtures/tiny-server.mjs',
      cwd: 'test',
      env: { TINY_GREETING: 'elsewhere' },
    });
    expect(await harness.call('say_hello')).toBe('hello elsewhere');
    await harness.close();
  });

  it('looks for dist/index.js when no entry is given', async () => {
    // The default is what every repository's suite will actually use, so it is
    // worth pinning that it points at the built artifact rather than src/.
    await expect(startServer({ env: {} })).rejects.toThrow(/dist\/index\.js/);
  });

  it('reports the server’s own message when a call fails', async () => {
    const harness = await startServer({ entry: TINY, env: {} });
    await expect(harness.call('always_fails')).rejects.toThrow(
      /always_fails failed: no/
    );
    await harness.close();
  });

  it('lets a refusal be the expected outcome', async () => {
    const harness = await startServer({ entry: TINY, env: {} });
    expect(await harness.call('always_fails', {}, { expectError: true })).toBe(
      'no'
    );
    await harness.close();
  });

  it('applies the handshake timeout it was given', async () => {
    // timeoutSeconds was declared, documented as "default 30", and never read:
    // connect() was called without options, so the SDK's own 60 seconds
    // applied. A repo with a slow-starting backend that raised it kept failing
    // at 60; one that lowered it kept waiting a minute per attempt.
    await expect(
      startServer({
        entry: TINY,
        env: { TINY_SILENT: '1', TINY_SLOW_START_MS: '4000' },
        timeoutSeconds: 1,
      })
    ).rejects.toThrow(/did not start/);
  });

  it('requires the stated reason, not merely a failure', async () => {
    // `expectError: true` alone says only that *something* failed. A renamed
    // parameter makes the schema reject the call, and a guard test written that
    // way stays green while the guard it names is never reached — twenty-seven
    // places in this fleet are written that way, several of them over SSRF
    // guards.
    const harness = await startServer({
      entry: TINY,
      env: { TINY_GREETING: 'x' },
    });
    await expect(
      harness.call('always_fails', {}, { expectError: 'read-only mode' })
    ).rejects.toThrow(/not for the stated reason/);
    await expect(
      harness.call('always_fails', {}, { expectError: /read-only mode/ })
    ).rejects.toThrow(/not for the stated reason/);
    await harness.close();
  });

  it('accepts a string or a pattern as the stated reason', async () => {
    const harness = await startServer({
      entry: TINY,
      env: { TINY_GREETING: 'x' },
    });
    const text = await harness.call('always_fails', {}, { expectError: true });
    // Whatever the fixture actually says, both forms of the assertion have to
    // agree with it — that is the whole contract.
    const word = text.split(/\s+/).find((part) => part.length > 3) ?? '';
    await harness.call('always_fails', {}, { expectError: word });
    await harness.call('always_fails', {}, { expectError: new RegExp(word) });
    await harness.close();
  });

  it('complains when a call was expected to fail and did not', async () => {
    const harness = await startServer({ entry: TINY, env: {} });
    await expect(
      harness.call('say_hello', {}, { expectError: true })
    ).rejects.toThrow(/expected to fail and did not/);
    await harness.close();
  });
});

describe('getting past a confirmation', () => {
  it('answers the dialog when the client can show one', async () => {
    const harness = await startServer({
      entry: TINY,
      env: {},
      elicit: 'accept',
    });
    expect(await harness.call('delete_thing', { id: 'a' })).toBe('deleted a');
    expect(harness.prompts).toHaveLength(1);
    expect(harness.prompts[0]).toContain('cannot be recovered');
    await harness.close();
  });

  it('declines, and nothing happens', async () => {
    const harness = await startServer({
      entry: TINY,
      env: {},
      elicit: 'decline',
    });
    expect(
      await harness.call('delete_thing', { id: 'a' }, { expectError: true })
    ).toContain('nothing was deleted');
    await harness.close();
  });

  it('cancels, and nothing happens either', async () => {
    // Decline and cancel are different answers — "no" versus "I closed the
    // dialog" — and a server is free to treat them differently. Both have to
    // end with the thing not deleted.
    const harness = await startServer({
      entry: TINY,
      env: {},
      elicit: 'cancel',
    });
    expect(
      await harness.call('delete_thing', { id: 'a' }, { expectError: true })
    ).toContain('nothing was deleted');
    await harness.close();
  });

  it('drives both halves of the token where no dialog exists', async () => {
    const harness = await startServer({ entry: TINY, env: {} });
    expect(await harness.confirmed('delete_thing', { id: 'b' })).toBe(
      'deleted b'
    );
    expect(harness.prompts).toHaveLength(0);
    await harness.close();
  });

  it('says why confirmed() found no token, rather than throwing a regex error', async () => {
    // The mistake this catches is real and easy: calling confirmed() on a
    // harness that declared elicitation. The server then correctly refuses to
    // offer a token at all, and without this message the failure is an opaque
    // "cannot read property 1 of null".
    const harness = await startServer({
      entry: TINY,
      env: {},
      elicit: 'accept',
    });
    await expect(
      harness.confirmed('delete_thing', { id: 'c' })
    ).rejects.toThrow(/did the client declare elicitation/);
    await harness.close();
  });

  it('extracts a token from a refusal', async () => {
    const harness = await startServer({ entry: TINY, env: {} });
    const first = await harness.call('delete_thing', { id: 'd' });
    expect(tokenOf(first)).toMatch(/^[0-9a-f]+$/);
    await harness.close();
  });
});

describe('what was called', () => {
  it('records every tool the harness touched, including failed calls', async () => {
    const harness = await startServer({ entry: TINY, env: {} });
    await harness.call('say_hello');
    await harness.call('mixed_content');
    await harness.call('always_fails', {}, { expectError: true });
    // A call that threw still counts as touched: the tool was reached, and the
    // coverage question is "did anything exercise this", not "did it pass".
    await expect(
      harness.call('delete_thing', { id: 'x' }, { expectError: true })
    ).rejects.toThrow();
    expect([...harness.called].sort()).toEqual([...ALL_TOOLS].sort());
    await harness.close();
  });
});
