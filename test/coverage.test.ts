import { describe, expect, it } from 'vitest';

import { expectEveryToolExercised, toolCoverage } from '../src/coverage.js';

const ALL = [
  'list_things',
  'create_thing',
  'delete_thing',
  'purge_all',
] as const;

/** A stand-in for the harness: the assertion reads only `called`. */
const ran = (...names: string[]) => ({ called: new Set(names) });

describe('the coverage report', () => {
  it('counts what ran, what was excused and what is missing', () => {
    const report = toolCoverage(ran('list_things', 'create_thing'), ALL, {
      purge_all: 'instance-wide; there is nothing to purge in a fresh sandbox',
    });
    expect(report).toEqual({
      called: ['create_thing', 'list_things'],
      skipped: ['purge_all'],
      missing: ['delete_thing'],
      staleReasons: [],
      unknownReasons: [],
    });
  });
});

describe('expectEveryToolExercised', () => {
  it('passes when every tool ran or has a reason', () => {
    expect(() =>
      expectEveryToolExercised(
        ran('list_things', 'create_thing', 'delete_thing'),
        ALL,
        { purge_all: 'instance-wide; nothing to purge in a fresh sandbox' }
      )
    ).not.toThrow();
  });

  it('fails on a tool that was neither called nor excused', () => {
    // The gap everyone expects, and the reason this function exists: without
    // it, a tool quietly drops out of the suite the day somebody reorders a
    // scenario, and the suite stays green.
    expect(() => expectEveryToolExercised(ran('list_things'), ALL, {})).toThrow(
      /never called and not excused: create_thing, delete_thing, purge_all/
    );
  });

  it('fails on a reason that is no longer true', () => {
    // The direction a plain "did we miss anything" check never looks in. A
    // stale reason is worse than a missing test: the next person reads it and
    // believes the tool cannot be exercised.
    expect(() =>
      expectEveryToolExercised(ran(...ALL), ALL, {
        purge_all: 'instance-wide; nothing to purge in a fresh sandbox',
      })
    ).toThrow(/excused tool\(s\) were called after all: purge_all/);
  });

  it('fails on a reason whose tool no longer exists', () => {
    // A tool gets renamed, its excuse stays behind, and the exception list
    // grows a member nobody can account for.
    expect(() =>
      expectEveryToolExercised(ran(...ALL), ALL, {
        delete_everything: 'this tool was removed in 0.3.0',
      })
    ).toThrow(/name a tool that no longer exists: delete_everything/);
  });

  it('reports every kind of problem at once, not the first', () => {
    // Three separate messages in one throw: fixing them one CI run at a time
    // is how a rollout across fourteen repositories turns into an afternoon.
    let message = '';
    try {
      expectEveryToolExercised(ran('list_things', 'create_thing'), ALL, {
        create_thing: 'excused but called',
        gone_tool: 'no longer exists',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('never called and not excused');
    expect(message).toContain('were called after all');
    expect(message).toContain('no longer exists');
  });

  it('leads with the numbers, because they are the report', () => {
    let message = '';
    try {
      expectEveryToolExercised(ran('list_things'), ALL, {});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^1 of 4 tools exercised, 0 excused\./);
  });

  it('treats an omitted skip map as an empty one', () => {
    expect(() => expectEveryToolExercised(ran(...ALL), ALL)).not.toThrow();
  });
});
