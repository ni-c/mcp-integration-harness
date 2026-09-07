import type { LiveHarness } from './harness.js';

/**
 * The reason a tool could not be exercised against a real backend.
 *
 * A `Record<tool, reason>` rather than a `string[]`, and that is the whole
 * design. A bare list lets a tool be dropped from the suite by adding six
 * characters, and nothing afterwards can tell a deliberate omission from a
 * forgotten one. A reason has to be written by a person, which is a small cost
 * exactly where a small cost is useful.
 *
 * Reasons that have earned their place look like:
 *
 *   list_listening_sessions: 'needs playback sessions; no tool can create one'
 *   approve_pipeline:        'needs a fork pipeline blocked on approval'
 *   get_page_conflict:       'needs two concurrent edits; see the conflict test'
 *
 * A reason that has not:
 *
 *   delete_everything: 'skipped'
 */
export type SkipReasons = Readonly<Record<string, string>>;

export interface CoverageReport {
  called: readonly string[];
  skipped: readonly string[];
  /** In the catalogue, neither called nor given a reason. */
  missing: readonly string[];
  /** Given a reason, but called anyway — the reason is stale. */
  staleReasons: readonly string[];
  /** Given a reason, but no longer a tool — the reason outlived its tool. */
  unknownReasons: readonly string[];
}

/**
 * Compares what ran against the catalogue, without asserting.
 *
 * Exported separately so a caller can print the numbers — "48 of 62 against a
 * real backend, 14 skipped with reasons" is worth having in a CI log even on a
 * green run.
 */
export function toolCoverage(
  harness: Pick<LiveHarness, 'called'>,
  allTools: readonly string[],
  skipped: SkipReasons
): CoverageReport {
  const catalogue = new Set(allTools);
  const reasons = Object.keys(skipped);
  return {
    called: [...harness.called].toSorted(),
    skipped: reasons.toSorted(),
    missing: allTools
      .filter((tool) => !harness.called.has(tool) && !(tool in skipped))
      .toSorted(),
    staleReasons: reasons.filter((tool) => harness.called.has(tool)).toSorted(),
    unknownReasons: reasons.filter((tool) => !catalogue.has(tool)).toSorted(),
  };
}

/**
 * Fails unless every tool in the catalogue was called or excused.
 *
 * Three directions, not one, because a coverage check that only looks for gaps
 * rots from the other end:
 *
 *   1. A tool neither called nor excused — the gap everyone expects.
 *   2. An excused tool that *was* called. The reason is now false, and a false
 *      reason is worse than none: the next person reads it and believes the
 *      tool cannot be tested.
 *   3. An excused tool that no longer exists. The tool was renamed or removed
 *      and its excuse stayed behind, quietly making the exception list look
 *      longer than the real one.
 *
 * Throws rather than returning, so it reads as one line in a test.
 */
export function expectEveryToolExercised(
  harness: Pick<LiveHarness, 'called'>,
  allTools: readonly string[],
  skipped: SkipReasons = {}
): void {
  const report = toolCoverage(harness, allTools, skipped);
  const problems: string[] = [];

  if (report.missing.length > 0) {
    problems.push(
      `${report.missing.length} tool(s) never called and not excused: ` +
        `${report.missing.join(', ')}. Call them, or give each a reason in the ` +
        'skip map saying what a real backend cannot provide.'
    );
  }
  if (report.staleReasons.length > 0) {
    problems.push(
      `${report.staleReasons.length} excused tool(s) were called after all: ` +
        `${report.staleReasons.join(', ')}. Remove the reason — it is no longer true.`
    );
  }
  if (report.unknownReasons.length > 0) {
    problems.push(
      `${report.unknownReasons.length} reason(s) name a tool that no longer ` +
        `exists: ${report.unknownReasons.join(', ')}.`
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `${report.called.length} of ${allTools.length} tools exercised, ` +
        `${report.skipped.length} excused.\n\n${problems.join('\n\n')}`
    );
  }
}

/**
 * One entry of `tools/list`, as much of it as this check reads.
 *
 * Structural rather than the SDK's `Tool`, like {@link expectEveryToolExercised}
 * takes a `Pick<LiveHarness, …>`: the result of `client.listTools()` satisfies it
 * as it comes, and the library stays free of a type-only import from a package it
 * only peer-depends on.
 */
export interface AdvertisedTool {
  name: string;
  outputSchema?: unknown;
}

export interface OutputSchemaReport {
  declared: readonly string[];
  exempt: readonly string[];
  /** Advertised without an `outputSchema`, and not exempt. */
  missing: readonly string[];
  /** Exempt, but declares one after all — the reason is stale. */
  staleReasons: readonly string[];
  /** Exempt, but no longer a tool — the reason outlived its tool. */
  unknownReasons: readonly string[];
  /** Declared with a root that is not `"object"`. */
  nonObjectRoot: readonly string[];
}

/** Whether a value is a JSON Schema whose instance root is an object. */
function hasObjectRoot(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  return (schema as { type?: unknown }).type === 'object';
}

/**
 * Compares the advertised tools against the rule, without asserting.
 *
 * Separate from the assertion for the reason {@link toolCoverage} is: "62 of 62
 * tools declare an output schema" belongs in a CI log on a green run too.
 */
export function outputSchemaCoverage(
  tools: readonly AdvertisedTool[],
  exempt: SkipReasons = {}
): OutputSchemaReport {
  const names = new Set(tools.map((tool) => tool.name));
  const reasons = Object.keys(exempt);
  const withSchema = tools.filter((tool) => tool.outputSchema !== undefined);
  return {
    declared: withSchema.map((tool) => tool.name).toSorted(),
    exempt: reasons.toSorted(),
    missing: tools
      .filter(
        (tool) => tool.outputSchema === undefined && !(tool.name in exempt)
      )
      .map((tool) => tool.name)
      .toSorted(),
    staleReasons: withSchema
      .filter((tool) => tool.name in exempt)
      .map((tool) => tool.name)
      .toSorted(),
    unknownReasons: reasons.filter((name) => !names.has(name)).toSorted(),
    nonObjectRoot: withSchema
      .filter((tool) => !hasObjectRoot(tool.outputSchema))
      .map((tool) => tool.name)
      .toSorted(),
  };
}

/**
 * Fails unless every advertised tool declares an output schema with an object
 * root.
 *
 * The presence half only. What the schema *says* needs no check here: a server
 * that declares an `outputSchema` and then answers with something else never
 * gets that answer past its own SDK, which validates `structuredContent`
 * against the advertised schema before it goes on the wire and turns a mismatch
 * into a failed call. So every ordinary assertion in the suite is already a
 * schema-against-reality check, and a validator in here would only re-examine
 * data that could not have arrived if it were wrong.
 *
 * The object root is checked, though, and is not pedantry. SEP-2106 lets an
 * output schema describe an array or a scalar, but a 2025-era client is served
 * that same tool with the schema rewritten to `{result: …}` — so a tool with a
 * non-object root answers in two different shapes depending on who asked. A
 * list is `{ items: [...] }`.
 *
 * Exemptions take a written reason and rot in the same three directions
 * {@link expectEveryToolExercised} guards against. The one that has earned its
 * place so far:
 *
 *   call_tool: 'forwards a child server's result; the shape is the child's'
 */
export function expectEveryToolDeclaresOutputSchema(
  tools: readonly AdvertisedTool[],
  exempt: SkipReasons = {}
): void {
  const report = outputSchemaCoverage(tools, exempt);
  const problems: string[] = [];

  if (report.missing.length > 0) {
    problems.push(
      `${report.missing.length} tool(s) declare no outputSchema: ` +
        `${report.missing.join(', ')}. Declare one and return structuredContent, ` +
        'or give each a reason saying why the shape is not this server to state.'
    );
  }
  if (report.staleReasons.length > 0) {
    problems.push(
      `${report.staleReasons.length} exempt tool(s) declare one after all: ` +
        `${report.staleReasons.join(', ')}. Remove the reason — it is no longer true.`
    );
  }
  if (report.unknownReasons.length > 0) {
    problems.push(
      `${report.unknownReasons.length} reason(s) name a tool that no longer ` +
        `exists: ${report.unknownReasons.join(', ')}.`
    );
  }
  if (report.nonObjectRoot.length > 0) {
    problems.push(
      `${report.nonObjectRoot.length} tool(s) declare a non-object root: ` +
        `${report.nonObjectRoot.join(', ')}. A 2025-era client is served that ` +
        'schema wrapped as {result: …}, so the answer has two shapes. Wrap the ' +
        'value in an object — a list is { items: [...] }.'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `${report.declared.length} of ${tools.length} tools declare an output ` +
        `schema, ${report.exempt.length} exempt.\n\n${problems.join('\n\n')}`
    );
  }
}
