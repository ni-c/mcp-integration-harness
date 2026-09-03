/**
 * Portability rules for the JSON Schemas a server advertises.
 *
 * A schema can be perfectly legal JSON Schema and still be refused or
 * mishandled by a client, and the four rules below are the ones this family of
 * servers has actually walked into. All four are spellings rather than
 * contracts: each has an equivalent form that says the same thing to a
 * validator and survives the trip to every client.
 *
 * The checks run against the schema as it goes out on the wire, which is the
 * only place they can run. Zod is what writes that schema here, and what it
 * writes changes between its own releases: `z.string().nullable()` emitted
 * `anyOf` up to zod 4.4 and a `"type": ["string", "null"]` array from 4.5 on.
 * A source-level rule would have missed that; a wire-level one cannot.
 */

/** Keywords that constrain the instance. Anything else only annotates it. */
const CONSTRAINING_KEYWORDS = new Set([
  // Assertions
  'type',
  'enum',
  'const',
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'maxItems',
  'minItems',
  'uniqueItems',
  'maxContains',
  'minContains',
  'maxProperties',
  'minProperties',
  'required',
  'dependentRequired',
  'format',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  // Applicators
  'items',
  'prefixItems',
  'contains',
  'additionalItems',
  'unevaluatedItems',
  'properties',
  'patternProperties',
  'additionalProperties',
  'propertyNames',
  'unevaluatedProperties',
  'dependentSchemas',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  // References
  '$ref',
  '$dynamicRef',
  '$recursiveRef',
]);

/**
 * Keywords whose value may be a bare boolean without anyone minding.
 *
 * `"additionalProperties": true` is the ordinary way to write an open object
 * and every client reads it. A bare `true` anywhere a schema *object* is
 * expected is a different matter.
 */
const BOOLEAN_VALUED_KEYWORDS = new Set([
  'additionalProperties',
  'unevaluatedProperties',
  'additionalItems',
  'unevaluatedItems',
]);

const SUBSCHEMA_KEYWORDS = [
  'items',
  'contains',
  'not',
  'propertyNames',
  'if',
  'then',
  'else',
  'additionalProperties',
  'unevaluatedProperties',
  'additionalItems',
  'unevaluatedItems',
  'contentSchema',
];
const SUBSCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SUBSCHEMA_MAP_KEYWORDS = [
  'properties',
  'patternProperties',
  'dependentSchemas',
  'dependencies',
  '$defs',
  'definitions',
];

const JSON_SCHEMA_TYPES = new Set([
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'string',
  'integer',
]);

/** Guards against a `$ref` cycle turning the walk into a hang. */
const MAX_DEPTH = 64;

/** Which spelling a finding is about. */
export type SchemaLintRule =
  'untyped-schema' | 'boolean-schema' | 'type-union' | 'remote-ref';

export interface SchemaFinding {
  rule: SchemaLintRule;
  /** The tool whose schema carries it. */
  tool: string;
  /** `inputSchema` or `outputSchema`, plus the path inside it. */
  path: string;
  /** What is wrong, and what to write instead. */
  message: string;
}

/** One entry of `tools/list`, as much of it as this check reads. */
export interface SchemaBearingTool {
  name: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function constrainsInstance(node: Record<string, unknown>): boolean {
  if (Object.keys(node).some((key) => CONSTRAINING_KEYWORDS.has(key))) {
    return true;
  }
  // `if` alone constrains nothing; with a branch beside it, it does.
  return 'if' in node && ('then' in node || 'else' in node);
}

function isPlainTypeUnion(type: unknown): type is string[] {
  if (!Array.isArray(type) || type.length === 0) return false;
  return type.every(
    (entry) => typeof entry === 'string' && JSON_SCHEMA_TYPES.has(entry)
  );
}

function walk(
  node: unknown,
  path: string,
  keyword: string | undefined,
  depth: number,
  emit: (rule: SchemaLintRule, path: string, message: string) => void
): void {
  if (depth > MAX_DEPTH) return;

  if (typeof node === 'boolean') {
    if (keyword !== undefined && BOOLEAN_VALUED_KEYWORDS.has(keyword)) return;
    emit(
      'boolean-schema',
      path,
      `bare \`${String(node)}\` where a schema object is expected. Write ` +
        (node
          ? 'the object form — `{}` under `not`, or the type the value really has.'
          : '`{"not": {}}`; deleting the entry allows the property instead of forbidding it.')
    );
    return;
  }
  if (!isRecord(node)) return;

  if (isPlainTypeUnion(node.type)) {
    emit(
      'type-union',
      path,
      `\`type\` is an array (${JSON.stringify(node.type)}). Several clients ` +
        'read `type` as a single string and drop the constraint or refuse the ' +
        'tool. Split it into `anyOf` branches — in zod, put `.describe()` on ' +
        'the inner type *before* `.nullable()`, which stops it folding the two ' +
        'into one `type` array.'
    );
  }

  const ref = node.$ref;
  if (typeof ref === 'string' && ref !== '' && !ref.startsWith('#')) {
    emit(
      'remote-ref',
      path,
      `\`$ref\` points outside this document (\`${ref}\`). Clients do not ` +
        'fetch remote schemas. Inline it, or move it into `$defs`.'
    );
  }

  if (!constrainsInstance(node) && keyword !== 'not') {
    emit(
      'untyped-schema',
      path,
      'no validation keyword at all, so this accepts any value — the object ' +
        'spelling of a bare `true`, which some clients refuse or mishandle. ' +
        'In zod: `.meta({ additionalProperties: true })` on a `looseObject` or ' +
        'a `catchall`, and the real type instead of `z.unknown()`.'
    );
  }

  for (const key of SUBSCHEMA_MAP_KEYWORDS) {
    const map = node[key];
    if (!isRecord(map)) continue;
    for (const [name, child] of Object.entries(map)) {
      walk(child, `${path}.${key}.${name}`, key, depth + 1, emit);
    }
  }
  for (const key of SUBSCHEMA_ARRAY_KEYWORDS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    list.forEach((child, index) => {
      walk(child, `${path}.${key}[${index}]`, key, depth + 1, emit);
    });
  }
  for (const key of SUBSCHEMA_KEYWORDS) {
    if (!(key in node)) continue;
    const child = node[key];
    if (key === 'items' && Array.isArray(child)) {
      child.forEach((entry, index) => {
        walk(entry, `${path}.${key}[${index}]`, key, depth + 1, emit);
      });
      continue;
    }
    walk(child, `${path}.${key}`, key, depth + 1, emit);
  }
}

/**
 * Lints the advertised schemas, without asserting.
 *
 * Separate from the assertion for the reason {@link toolCoverage} is: the count
 * is worth a line in a CI log on a green run too.
 */
export function schemaPortability(
  tools: readonly SchemaBearingTool[]
): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  for (const tool of tools) {
    for (const kind of ['inputSchema', 'outputSchema'] as const) {
      const schema = tool[kind];
      if (schema === undefined) continue;
      walk(schema, kind, undefined, 0, (rule, path, message) => {
        findings.push({ rule, tool: tool.name, path, message });
      });
    }
  }
  return findings;
}

/**
 * Fails unless every advertised schema is one every client can read.
 *
 * No exemption map, unlike the checks in `coverage.ts`. Those excuse what a
 * *backend* cannot provide, which is a fact about the world and needs writing
 * down. There is nothing to excuse here: every finding has an equivalent
 * spelling that says the same thing, so a reason could only ever read "not
 * fixed yet".
 */
export function expectPortableToolSchemas(
  tools: readonly SchemaBearingTool[]
): void {
  const findings = schemaPortability(tools);
  if (findings.length === 0) return;

  const lines = findings.map(
    (finding) => `  ${finding.tool} — ${finding.path}: ${finding.message}`
  );
  throw new Error(
    `${findings.length} schema portability problem(s) across ` +
      `${tools.length} tool(s):\n\n${lines.join('\n\n')}`
  );
}
