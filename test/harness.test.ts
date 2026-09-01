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
