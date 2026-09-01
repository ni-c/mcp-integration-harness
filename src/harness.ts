import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

/**
 * Driving a built MCP server over real stdio, against a real backend.
 *
 * Every unit suite in this family links a server to a client with
 * `InMemoryTransport` and replaces the network underneath. That is the right
 * trade for a unit test, and it leaves four things untested in every repository:
 * `src/index.ts`, `loadConfig` reading a real environment, the stdio transport's
 * framing, and elicitation across a process boundary. This spawns the built
 * artifact instead, so all four are on the path.
 */

/** How a client that can show a dialog answers it. */
export type ElicitBehaviour = 'accept' | 'decline' | 'cancel';

export interface StartServerOptions {
  /** The built entry point. Relative paths resolve against `cwd`. */
  entry?: string;
  /** Where to run it. Defaults to the current working directory. */
  cwd?: string;
  /**
   * The server's entire environment, `PATH` aside.
   *
   * Deliberately not merged with `process.env`. A `WIKIJS_URL` left in a shell
   * is otherwise enough to point an integration run — deletes included — at
   * whatever that variable happens to name. Nothing is inherited, so nothing
   * can be inherited by accident.
   */
  env: Record<string, string>;
  /**
   * How the client answers a confirmation dialog. Omitted means the client
   * declares no elicitation capability at all, which is what makes a guarded
   * tool fall back to the two-call token — see {@link LiveHarness.confirmed}.
   */
  elicit?: ElicitBehaviour;
  /** Seconds to wait for the handshake. Default 30. */
  timeoutSeconds?: number;
}

export interface CallOptions {
  /** Assert that the call fails. Refusals are behaviour worth pinning too. */
  expectError?: boolean;
}

export interface ToolResult {
  content?: { type: string; text?: string; mimeType?: string; data?: string }[];
  isError?: boolean;
}

export interface LiveHarness {
  client: Client;
  /**
   * Calls a tool, records it against the coverage set, returns the text.
   *
   * Throws when the outcome is not the expected one, with the server's own
   * message attached — a failure here is nearly always the backend saying
   * something the stubbed unit tests never had to say.
   */
  call(
    name: string,
    args?: Record<string, unknown>,
    options?: CallOptions
  ): Promise<string>;
  /**
   * The same, returning the whole result rather than its text.
   *
   * For a tool that answers with an image or a resource — a cover, a QR code,
   * an uploaded asset — where the parts are the point. Reaching for
   * `harness.client` instead would skip the coverage bookkeeping, and the
   * missing tool would then have to be added to `called` by hand, which is
   * exactly the sort of thing that stops being done.
   */
  raw(
    name: string,
    args?: Record<string, unknown>,
    options?: CallOptions
  ): Promise<ToolResult>;
  /**
   * Drives both halves of the two-call token for one guarded tool.
   *
   * Only meaningful on a harness started **without** `elicit`: with a dialog
   * available the server refuses to offer a token at all, which is the whole
   * point of the dialog. Use it to prove the fallback path still works.
   */
  confirmed(name: string, args?: Record<string, unknown>): Promise<string>;
  /** Every message the server put in front of the user, in order. */
  prompts: string[];
  /** The tools that were called. What {@link expectEveryToolExercised} reads. */
  called: ReadonlySet<string>;
  /** Everything the server wrote to stderr, for a failure report. */
  stderr(): string;
  close(): Promise<void>;
}

/** Pulls the fallback token out of a refusal. */
export function tokenOf(text: string): string {
  const match = /confirm_token="([0-9a-f]+)"/.exec(text);
  if (!match?.[1]) {
    throw new Error(
      `no confirm_token in the result — did the client declare elicitation? ` +
        `Got: ${text.slice(0, 300)}`
    );
  }
  return match[1];
}

/** The text parts of a tool result, joined. */
function textOf(result: { content?: unknown }): string {
  const parts = (result.content ?? []) as { type: string; text?: string }[];
  return parts
    .filter(
      (part): part is { type: 'text'; text: string } => part.type === 'text'
    )
    .map((part) => part.text)
    .join('\n');
}

export async function startServer(
  options: StartServerOptions
): Promise<LiveHarness> {
  const entry = options.entry ?? 'dist/index.js';
  const prompts: string[] = [];
  const called = new Set<string>();
  const errors: string[] = [];

  const client = new Client(
    { name: 'mcp-integration-harness', version: '0.1.0' },
    options.elicit === undefined ? {} : { capabilities: { elicitation: {} } }
  );
  if (options.elicit !== undefined) {
    const behaviour = options.elicit;
    client.setRequestHandler('elicitation/create', (request) => {
      // `message` is required by the elicitation schema, so no fallback: a
      // server that omitted it should surface as an empty prompt in the
      // assertion, not be papered over here.
      prompts.push((request.params as { message: string }).message);
      if (behaviour === 'cancel') return { action: 'cancel' };
      if (behaviour === 'decline') return { action: 'decline' };
      return { action: 'accept', content: { confirm: true } };
    });
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    // PATH only. See the comment on StartServerOptions.env.
    env: { PATH: process.env.PATH ?? '', ...options.env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stderr: 'pipe',
  });

  // Attached before connect, not after: the startup banner and any refusal to
  // start are written during the handshake, and a listener added afterwards
  // has already missed them. The transport hands back a PassThrough
  // immediately for exactly this reason.
  transport.stderr?.on('data', (chunk: Buffer) => {
    errors.push(chunk.toString());
  });

  try {
    await client.connect(transport);
  } catch (error) {
    // A server that dies during the handshake reports "Connection closed" and
    // nothing else, while the reason — a missing dist/, a config error, a
    // refused credential — is sitting in the stderr just captured. Without this
    // the most common first failure of a new suite is also the least legible.
    throw new Error(
      `mcp-integration-harness: ${process.execPath} ${entry} did not start.\n` +
        `${String(error)}\n\nIts stderr:\n${errors.join('') || '(nothing)'}`
    );
  }

  const raw = async (
    name: string,
    args: Record<string, unknown> = {},
    callOptions: CallOptions = {}
  ): Promise<ToolResult> => {
    called.add(name);
    const result = (await client.callTool({
      name,
      arguments: args,
    })) as ToolResult;
    const failed = result.isError === true;
    if (failed !== (callOptions.expectError ?? false)) {
      const text = textOf(result);
      throw new Error(
        callOptions.expectError
          ? `${name} was expected to fail and did not: ${text.slice(0, 500)}`
          : `${name} failed: ${text.slice(0, 500)}`
      );
    }
    return result;
  };

  const call = async (
    name: string,
    args: Record<string, unknown> = {},
    callOptions: CallOptions = {}
  ): Promise<string> => textOf(await raw(name, args, callOptions));

  return {
    client,
    call,
    raw,
    prompts,
    called,
    stderr: () => errors.join(''),
    confirmed: async (name, args = {}) => {
      const first = await call(name, args);
      return call(name, { ...args, confirm_token: tokenOf(first) });
    },
    close: async () => {
      await client.close();
    },
  };
}
