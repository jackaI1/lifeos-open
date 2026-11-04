import assert from 'node:assert/strict';

/**
 * Offline interpreter for the expression subset used by the reminder Queries.
 * Executes the JSON expressions, not a second implementation of the date filter.
 * Unknown syntax/functions fail closed. This is not a Microsoft tenant runtime.
 * Semantics: https://learn.microsoft.com/azure/logic-apps/expression-functions-reference
 */
export function runReminderQueries(definition: any, rows: Record<string, unknown>[], tomorrow: string) {
  const formattedDates: string[] = [];
  const results: Record<string, any> = {
    Get_open_tasks: {'body/value': rows},
    Tomorrow: tomorrow,
  };

  function evaluate(expression: string, row?: Record<string, unknown>): any {
    assert.ok(expression.startsWith('@'), 'expected a workflow expression');
    const source = expression.slice(1);
    let cursor = 0;
    const take = (pattern: RegExp): string | undefined => {
      const match = pattern.exec(source.slice(cursor));
      if (!match) return undefined;
      cursor += match[0].length;
      return match[0];
    };
    const expect = (token: string) => {
      assert.equal(source.slice(cursor, cursor + token.length), token, `at ${source.slice(cursor)}`);
      cursor += token.length;
    };
    const functions: Record<string, (...args: any[]) => any> = {
      item: () => row,
      outputs: (name: string) => output(name),
      body: (name: string) => output(name),
      empty: (value: unknown) => value == null || value === '' || (Array.isArray(value) && value.length === 0),
      not: (value: boolean) => !value,
      equals: (left: unknown, right: unknown) => left === right,
      formatDateTime: (value: unknown, format: string) => {
        // JS Date(null) is valid; WDL formatDateTime(null) must instead fail.
        assert.equal(typeof value, 'string', 'formatDateTime requires a timestamp string');
        assert.equal(format, 'yyyy-MM-dd', 'unsupported test format');
        assert.match(value as string, /^\d{4}-\d{2}-\d{2}T/);
        assert.ok(Number.isFinite(Date.parse(value as string)), 'invalid timestamp');
        formattedDates.push(value as string);
        return (value as string).slice(0, 10);
      },
    };
    function parse(): any {
      take(/^\s*/);
      const literal = take(/^'(?:[^']|'')*'/);
      let value: any;
      if (literal !== undefined) {
        value = literal.slice(1, -1).replaceAll("''", "'");
      } else {
        const name = take(/^[A-Za-z_][A-Za-z_0-9]*/);
        assert.ok(name && functions[name], `unsupported function at ${source.slice(cursor)}`);
        expect('(');
        const args: any[] = [];
        take(/^\s*/);
        if (source[cursor] !== ')') {
          args.push(parse());
          while (take(/^,\s*/)) args.push(parse());
        }
        expect(')');
        // Eager arguments: a guard in and(...) would not hide an invalid format call.
        value = functions[name](...args);
      }
      while (take(/^\?\[/)) {
        const key = take(/^'[^']*'/);
        assert.ok(key, 'expected a property name');
        expect(']');
        value = value?.[key.slice(1, -1)] ?? null;
      }
      take(/^\s*/);
      return value;
    }
    const value = parse();
    assert.equal(cursor, source.length, `unparsed expression: ${source.slice(cursor)}`);
    return value;
  }

  function output(name: string): any {
    if (Object.hasOwn(results, name)) return results[name];
    const action = definition.actions[name];
    assert.equal(action?.type, 'Query', `unsupported offline action: ${name}`);
    const input = evaluate(action.inputs.from);
    assert.ok(Array.isArray(input), `${name} requires an array`);
    results[name] = input.filter((row) => {
      const keep = evaluate(action.inputs.where, row);
      assert.equal(typeof keep, 'boolean');
      return keep;
    });
    return results[name];
  }

  return {dueItems: output('Keep_items_due_tomorrow') as Record<string, unknown>[], formattedDates};
}
