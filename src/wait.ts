import { assertLoopback } from './loopback.js';

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
