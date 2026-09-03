import { describe, expect, it } from 'vitest';

import {
  expectPortableToolSchemas,
  schemaPortability,
} from '../src/schema-lint.js';

/** The shape a portable tool advertises: everything named, nothing bare. */
const portable = {
  name: 'list_things',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer' } },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      things: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
      cursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    additionalProperties: true,
  },
};

describe('schemaPortability', () => {
  it('says nothing about a schema every client can read', () => {
    expect(schemaPortability([portable])).toEqual([]);
  });

  it('finds the empty schema zod writes for a loose object', () => {
    const findings = schemaPortability([
      {
        name: 'list_things',
        outputSchema: {
          type: 'object',
          properties: { things: { type: 'array', items: {} } },
          additionalProperties: {},
        },
      },
    ]);
    expect(findings.map((f) => `${f.rule} ${f.path}`)).toEqual([
      'untyped-schema outputSchema.properties.things.items',
      'untyped-schema outputSchema.additionalProperties',
    ]);
    expect(findings[0]?.tool).toBe('list_things');
  });

  it('accepts a bare boolean where a boolean is the ordinary spelling', () => {
    expect(
      schemaPortability([
        {
          name: 'get_thing',
          outputSchema: { type: 'object', additionalProperties: true },
        },
      ])
    ).toEqual([]);
  });

  it('reports a bare boolean where a schema object is expected', () => {
    const findings = schemaPortability([
      {
        name: 'get_thing',
        outputSchema: {
          type: 'object',
          properties: { anything: true, forbidden: false },
        },
      },
    ]);
    expect(findings.map((f) => f.rule)).toEqual([
      'boolean-schema',
      'boolean-schema',
    ]);
  });

  it('leaves an empty schema alone under `not`, where it is exact', () => {
    expect(
      schemaPortability([
        { name: 'get_thing', outputSchema: { type: 'object', not: {} } },
      ])
    ).toEqual([]);
  });

  it('finds the `type` array a nullable primitive folds into', () => {
    const findings = schemaPortability([
      {
        name: 'get_thing',
        outputSchema: {
          type: 'object',
          properties: { name: { type: ['string', 'null'] } },
        },
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'type-union',
      path: 'outputSchema.properties.name',
    });
  });

  it('finds a $ref that leaves the document', () => {
    const findings = schemaPortability([
      {
        name: 'get_thing',
        inputSchema: {
          type: 'object',
          properties: { id: { $ref: 'https://example.com/id.json' } },
        },
      },
    ]);
    expect(findings.map((f) => f.rule)).toEqual(['remote-ref']);
  });

  it('follows a local $ref target without following it in circles', () => {
    expect(
      schemaPortability([
        {
          name: 'get_thing',
          outputSchema: {
            type: 'object',
            properties: { self: { $ref: '#/$defs/node' } },
            $defs: { node: { type: 'object', additionalProperties: true } },
          },
        },
      ])
    ).toEqual([]);
  });

  it('reads the tuple form of `items`, which a hand-written schema still uses', () => {
    const findings = schemaPortability([
      {
        name: 'get_pair',
        outputSchema: {
          type: 'object',
          properties: {
            pair: {
              type: 'array',
              items: [{ type: 'string' }, {}],
            },
          },
        },
      },
    ]);
    expect(findings.map((f) => `${f.rule} ${f.path}`)).toEqual([
      'untyped-schema outputSchema.properties.pair.items[1]',
    ]);
  });

  it('counts `if` as constraining only with a branch beside it', () => {
    const withBranch = schemaPortability([
      {
        name: 'get_thing',
        outputSchema: {
          type: 'object',
          properties: {
            // `then` here is the JSON Schema keyword, not a thenable.
            // oxlint-disable-next-line no-thenable
            a: { if: { const: 1 }, then: { type: 'string' } },
            b: { if: { const: 1 } },
          },
        },
      },
    ]);
    expect(withBranch.map((f) => f.path)).toEqual([
      'outputSchema.properties.b',
    ]);
  });

  it('walks past a child that is not a schema at all', () => {
    expect(
      schemaPortability([
        {
          name: 'get_thing',
          outputSchema: { type: 'object', properties: { a: null } },
        },
      ])
    ).toEqual([]);
  });

  it('stops at the depth limit rather than following a schema down forever', () => {
    let node: Record<string, unknown> = {};
    for (let i = 0; i < 70; i += 1) {
      node = { type: 'object', properties: { next: node } };
    }
    expect(
      schemaPortability([{ name: 'get_thing', outputSchema: node }])
    ).toEqual([]);
  });

  it('reads a tool that declares neither schema', () => {
    expect(schemaPortability([{ name: 'ping' }])).toEqual([]);
  });
});

describe('expectPortableToolSchemas', () => {
  it('passes on a portable catalogue', () => {
    expect(() => expectPortableToolSchemas([portable])).not.toThrow();
  });

  it('names the tool, the path and the way out', () => {
    expect(() =>
      expectPortableToolSchemas([
        {
          name: 'list_things',
          outputSchema: { type: 'object', additionalProperties: {} },
        },
      ])
    ).toThrow(/list_things — outputSchema\.additionalProperties.*meta/s);
  });
});
