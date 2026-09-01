import { createConnection } from 'node:net';

import { assertLoopback, assertLoopbackHost } from './loopback.js';

export interface WaitOptions {
  /** How long to keep trying. Default 120 s — a cold Postgres is slow. */
  timeoutSeconds?: number;
  /** Between attempts. Default 1 s. */
  intervalMs?: number;
  /** What counts as ready. Default: any response at all. */
  ready?: (response: Response) => boolean;
}

/**
 * Waits for a backend to answer, or explains why it never did.
 *
 * `docker compose up --wait` covers the services that declare a healthcheck,
 * and most upstream images do not. The alternative people reach for is a fixed
 * `sleep 30`, which is both too long on a warm machine and too short on a cold
 * one — and when it is too short the failure surfaces as the first tool call
 * returning ECONNREFUSED, which reads like a bug in the tool.
 *
 * The last error is kept and thrown, because "timed out" on its own does not
 * distinguish "not listening yet" from "listening and answering 500".
 *
 * For a backend that does not speak HTTP, use {@link waitForTcp}. `fetch`
 * against an IMAP or SMTP port does not resolve — the greeting is not an HTTP
 * response, so it rejects, and this would report a timeout for a server that
 * came up immediately.
 */
export async function waitForHttp(
  url: string,
  options: WaitOptions = {}
): Promise<void> {
  assertLoopback(url);
  const timeoutSeconds = options.timeoutSeconds ?? 120;
  const deadline = Date.now() + timeoutSeconds * 1000;
  const interval = options.intervalMs ?? 1000;
  const ready = options.ready ?? (() => true);
  let last = 'no attempt completed';

  for (;;) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
      });
      if (ready(response)) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      // `String(error)` rather than `error.message`: the message alone is often
      // just "fetch failed", and the constructor name is the half that says
      // whether nothing was listening or the request timed out.
      last = String(error);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `mcp-integration-harness: ${url} did not become ready within ` +
          `${timeoutSeconds}s. Last attempt: ${last}. ` +
          'Is the compose stack up? `docker compose logs` usually says why.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export interface TcpWaitOptions {
  timeoutSeconds?: number;
  intervalMs?: number;
  /**
   * Text the server must send unprompted, if it greets.
   *
   * IMAP answers `* OK`, SMTP answers `220`. Checking the greeting rather than
   * only the connection is what tells "the port is open" from "the service
   * behind it has finished starting" — Docker publishes the port before the
   * process inside is listening on it, so a bare connect can succeed against
   * nothing.
   */
  expect?: string;
}

/**
 * Waits for a plain TCP service — IMAP, SMTP, anything not HTTP.
 *
 * Several backends in this family do not speak HTTP at all, and `fetch`
 * against them rejects rather than answering: undici cannot parse an IMAP
 * greeting as an HTTP response, so {@link waitForHttp} reports a timeout for a
 * server that was ready in a second.
 */
export async function waitForTcp(
  host: string,
  port: number,
  options: TcpWaitOptions = {}
): Promise<void> {
  assertLoopbackHost(host);
  const timeoutSeconds = options.timeoutSeconds ?? 120;
  const deadline = Date.now() + timeoutSeconds * 1000;
  const interval = options.intervalMs ?? 1000;
  let last = 'no attempt completed';

  for (;;) {
    try {
      await attempt(host, port, options.expect);
      return;
    } catch (error) {
      last = String(error);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `mcp-integration-harness: ${host}:${port} did not become ready within ` +
          `${timeoutSeconds}s. Last attempt: ${last}. ` +
          'Is the compose stack up? `docker compose logs` usually says why. ' +
          'A service that binds 127.0.0.1 *inside* its container publishes a ' +
          'port that reaches nothing — check what its log says it bound to.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

function attempt(
  host: string,
  port: number,
  expect: string | undefined
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const done = (error?: Error): void => {
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(5000, () => done(new Error('timed out')));
    socket.on('error', done);
    if (expect === undefined) {
      socket.on('connect', () => done());
      return;
    }
    let greeting = '';
    socket.on('data', (chunk: Buffer) => {
      greeting += chunk.toString('utf8');
      if (greeting.includes(expect)) done();
      else if (greeting.length > 4096) {
        done(new Error(`greeting did not contain ${expect}`));
      }
    });
  });
}
