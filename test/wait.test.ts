import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { waitForHttp, waitForTcp } from '../src/wait.js';

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
    await expect(waitForHttp('https://wiki.example.com')).rejects.toThrow(
      /refusing to talk to/
    );
  });
});

describe('waiting for a plain TCP service', () => {
  it('returns as soon as the port accepts', async () => {
    const url = await listen(() => 200);
    const port = Number(new URL(url).port);
    await expect(waitForTcp('127.0.0.1', port)).resolves.toBeUndefined();
  });

  it('waits for a greeting when one is expected', async () => {
    // Docker publishes a port before the process inside is listening on it,
    // so a bare connect can succeed against nothing. IMAP answers `* OK` and
    // SMTP answers `220`; checking for that is what tells the port being open
    // from the service being ready.
    running = createServer();
    const greeter = createTcpServer((socket) => socket.write('* OK ready\r\n'));
    await new Promise<void>((resolve) =>
      greeter.listen(0, '127.0.0.1', resolve)
    );
    const address = greeter.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }
    try {
      await waitForTcp('127.0.0.1', address.port, { expect: '* OK' });
    } finally {
      await new Promise<void>((resolve) => greeter.close(() => resolve()));
    }
  });

  it('says what to look at when nothing ever listens', async () => {
    await expect(
      waitForTcp('127.0.0.1', 1, { timeoutSeconds: 0, intervalMs: 10 })
    ).rejects.toThrow(/did not become ready within 0s/);
    // The failure mode that costs the most time, named in the message.
    await expect(
      waitForTcp('127.0.0.1', 1, { timeoutSeconds: 0, intervalMs: 10 })
    ).rejects.toThrow(/binds 127\.0\.0\.1 \*inside\* its container/);
  });

  it('gives up on a greeting that never says the right thing', async () => {
    // A service on the wrong port answers *something*, at length. Reading
    // until it matches would hang; this bounds it.
    const noisy = createTcpServer((socket) => socket.write('x'.repeat(5000)));
    await new Promise<void>((resolve) => noisy.listen(0, '127.0.0.1', resolve));
    const address = noisy.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }
    try {
      await expect(
        waitForTcp('127.0.0.1', address.port, {
          expect: '* OK',
          timeoutSeconds: 0,
          intervalMs: 10,
        })
      ).rejects.toThrow(/greeting did not contain \* OK/);
    } finally {
      await new Promise<void>((resolve) => noisy.close(() => resolve()));
    }
  });

  it('retries between attempts rather than spinning', async () => {
    // Nothing is listening on the first attempt and something is on the
    // second, which only works if the wait actually loops.
    const late = createTcpServer();
    const port = await new Promise<number>((resolve) => {
      late.listen(0, '127.0.0.1', () => {
        const address = late.address();
        if (address === null || typeof address === 'string') {
          throw new Error('expected a TCP address');
        }
        const chosen = address.port;
        late.close(() => resolve(chosen));
      });
    });
    const reopened = createTcpServer();
    setTimeout(() => reopened.listen(port, '127.0.0.1'), 60);
    try {
      await waitForTcp('127.0.0.1', port, { intervalMs: 20 });
    } finally {
      await new Promise<void>((resolve) => reopened.close(() => resolve()));
    }
  });

  it('gives up on a connection that is accepted and then goes silent', async () => {
    // The failure a bare `connect` check cannot see: the port is open, the
    // handshake completes, and nothing ever arrives. Without the socket
    // timeout this waits forever rather than reporting anything.
    const silent = createTcpServer(() => {
      /* accept and say nothing */
    });
    await new Promise<void>((resolve) =>
      silent.listen(0, '127.0.0.1', resolve)
    );
    const address = silent.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }
    try {
      await expect(
        waitForTcp('127.0.0.1', address.port, {
          expect: '* OK',
          timeoutSeconds: 0,
          intervalMs: 10,
        })
      ).rejects.toThrow(/timed out/);
    } finally {
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  }, 20_000);

  it('refuses a host that is not on this machine, before connecting', async () => {
    await expect(waitForTcp('imap.example.net', 143)).rejects.toThrow(
      /refusing to talk to/
    );
  });
});
