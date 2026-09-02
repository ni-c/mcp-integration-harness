#!/usr/bin/env node
/**
 * The smallest MCP server that can stand in for a real one.
 *
 * Four tools, one per thing the harness has to prove: an ordinary call, a
 * guarded call that must be confirmed, a result with a non-text part in it, and
 * a call that is supposed to fail. It reads `TINY_GREETING` from its
 * environment so a test can show that the server saw exactly what `startServer`
 * passed and nothing else.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  ConfirmationStore,
  createApproval,
  setResourceKey,
} from 'mcp-approval';
import { z } from 'zod';

const server = new McpServer({ name: 'tiny', version: '0.0.0' });
const confirmations = new ConfirmationStore();
const approval = createApproval({ server: 'tiny' });

// Announced on stderr, like every server in this family, so a test can show the
// harness captures the startup banner rather than losing it to the handshake.
// TINY_SILENT is for the opposite case: a server that says nothing, so the
// harness has to report the absence rather than an empty string.
if (process.env.TINY_SILENT !== '1') {
  console.error(
    `tiny: starting with greeting=${process.env.TINY_GREETING ?? '(unset)'}`
  );
}

// The mistake this fixture exists to reproduce: a server — or a dependency of
// one — writing to stdout, which belongs to the transport. Valid JSON that is
// not a JSON-RPC message reaches the client's onerror; the harness has to
// report it rather than let the suite stay green.
if (process.env.TINY_POLLUTE_STDOUT === '1') {
  process.stdout.write(`${JSON.stringify({ hello: 'from a dependency' })}\n`);
}

// What the server sees of the parent's environment, so a test can assert on
// the names the SDK merges in underneath what startServer passes.
if (process.env.TINY_REPORT_ENV === '1') {
  console.error(
    `tiny: env HOME=${process.env.HOME || '(unset)'} USER=${
      process.env.USER || '(unset)'
    } SHELL=${process.env.SHELL || '(unset)'}`
  );
}

server.registerTool(
  'say_hello',
  {
    title: 'Say hello',
    description: 'Returns the greeting from the environment.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  () => ({
    content: [
      { type: 'text', text: `hello ${process.env.TINY_GREETING ?? '(unset)'}` },
    ],
  })
);

server.registerTool(
  'delete_thing',
  {
    title: 'Delete a thing',
    description: 'Asks first.',
    inputSchema: z.object({
      id: z.string(),
      confirm_token: z.string().optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ id, confirm_token }, mcp) => {
    const outcome = await approval.requestApproval(server, mcp, confirmations, {
      what: `delete thing ${id}`,
      consequence: 'It cannot be recovered.',
      resourceKey: setResourceKey('delete_thing', [id]),
      token: confirm_token,
      toolName: 'delete_thing',
    });
    if (outcome.decision === 'rejected') {
      return {
        content: [{ type: 'text', text: outcome.reason }],
        isError: true,
      };
    }
    if (outcome.decision === 'declined') {
      return {
        content: [{ type: 'text', text: 'declined; nothing was deleted' }],
        isError: true,
      };
    }
    if (outcome.decision === 'pending') return outcome.result;
    return { content: [{ type: 'text', text: `deleted ${id}` }] };
  }
);

server.registerTool(
  'mixed_content',
  {
    title: 'Mixed content',
    description: 'Returns a text part and a non-text part.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  () => ({
    content: [
      { type: 'text', text: 'the text part' },
      // Real servers return these — upload_asset, get_client_qrcode. The
      // harness has to skip them rather than stringify them into the text it
      // hands back to an assertion.
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      { type: 'text', text: 'and another' },
    ],
  })
);

server.registerTool(
  'always_fails',
  {
    title: 'Always fails',
    description: 'For the expectError path.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  () => ({ content: [{ type: 'text', text: 'no' }], isError: true })
);

// Delays the handshake, so a test can show that the timeout the caller asked
// for is the one that applies. The option was declared and documented for
// months without ever being read.
if (process.env.TINY_SLOW_START_MS !== undefined) {
  await new Promise((resolve) =>
    setTimeout(resolve, Number(process.env.TINY_SLOW_START_MS))
  );
}

await server.connect(new StdioServerTransport());
