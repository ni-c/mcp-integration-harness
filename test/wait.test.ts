import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { waitForHttp } from '../src/wait.js';

let running: Server | undefined;

/** Starts a throwaway HTTP server on a loopback port and returns its URL. */
async function listen(handler: (status: number) => number): Promise<string> {
  let calls = 0;
  running = createServer((_request, response) => {
    response.writeHead(handler(++calls));
    response.end('ok');
  });
  await new Promise<void>((resolve) =>
    running!.listen(0, '127.0.0.1', resolve)
  );
  const address = running.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP address');
  }
  return `http://127.0.0.1:${address.port}/`;
}

afterEach(async () => {
  if (running) {
    await new Promise<void>((resolve) => running!.close(() => resolve()));
    running = undefined;
  }
});

describe('waiting for a backend', () => {
  it('returns as soon as the backend answers', async () => {
    // No options at all: the defaults have to be usable, because a bootstrap
    // that has to pass three of them every time will end up copied wrong.
    const url = await listen(() => 200);
    await expect(waitForHttp(url)).resolves.toBeUndefined();
  });

  it('keeps waiting until the readiness check is satisfied', async () => {
    // A backend that is listening is not the same as a backend that is ready.
    // Wiki.js answers 503 while it restarts its master process after finalize,
    // and a plain "did the socket accept" check would call that ready.
    const url = await listen((call) => (call < 3 ? 503 : 200));
    await waitForHttp(url, {
      timeoutSeconds: 5,
      intervalMs: 10,
      ready: (response) => response.status === 200,
    });
  });

  it('reports the last status rather than just “timed out”', async () => {
    const url = await listen(() => 503);
    await expect(
      waitForHttp(url, {
        timeoutSeconds: 0,
        intervalMs: 10,
        ready: (response) => response.status === 200,
      })
    ).rejects.toThrow(/Last attempt: HTTP 503/);
  });

  it('reports the connection error when nothing is listening', async () => {
    // The difference this preserves: "not listening yet" and "listening and
    // answering 500" need different fixes, and a bare timeout tells them apart
    // for nobody.
    await expect(
      waitForHttp('http://127.0.0.1:1/', { timeoutSeconds: 0, intervalMs: 10 })
    ).rejects.toThrow(/did not become ready within 0s\. Last attempt: .+/);
  });

  it('refuses to poll anything that is not on this machine', async () => {
    // No request is made — the guard runs before the first fetch, so a
    // misconfigured URL cannot even reach out once.
    await expect(waitForHttp('https://wiki.roamsys.com')).rejects.toThrow(
      /refusing to run against/
    );
  });
});
