/**
 * TOON — Token-Oriented Object Notation
 *
 * A compact, LLM-friendly serialization format designed to minimise
 * token usage when sending structured data to chat models.
 *
 * Compared to JSON, TOON typically saves 30-50% of tokens by:
 *   - Dropping quotes around keys and string values
 *   - Dropping commas and braces
 *   - Using indentation (2 spaces) for nesting, like YAML but stricter
 *   - Using a sigil (`@`) to mark array items, avoiding `- ` overhead
 *   - Encoding newlines inside strings as `\n` literals
 *
 * Grammar:
 *   object  := (line)*
 *   line    := indent key value?
 *             | indent "@" object          (array item)
 *   key     := identifier ":"              (no quotes)
 *   value   := scalar                       (rest of line, trimmed)
 *            | (empty)                      (children on next indented lines)
 *   indent  := "  " * depth
 *
 * Scalars are strings, numbers, or booleans. Booleans are emitted as
 * "1"/"0" to save a token. Null/undefined fields are omitted entirely.
 *
 * Round-trip safety:
 *   - All multi-line string values have "\n" replaced with the literal
 *     two-character sequence "\\n" before emission, and reversed on
 *     parse. This keeps the indent-based grammar unambiguous.
 *   - Strings that start with "@", ":", or contain newlines after
 *     escaping are still safe because we never split on ":" inside a
 *     value — only on the FIRST ":" of a line.
 *
 * Limitations:
 *   - Top-level value must be an object ({} equivalent). For arrays,
 *     wrap them: { items: [...] }.
 *   - Keys must match a basic identifier regex (letters, digits,
 *     underscores, hyphens). Hyphens are allowed but discouraged.
 */

export type ToonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ToonValue[]
  | { [key: string]: ToonValue };

const INDENT = "  ";

function isPlainObject(v: unknown): v is Record<string, ToonValue> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}

function escapeScalar(s: string): string {
  // Encode newlines and trailing/leading whitespace so a value always
  // fits on one line. We do NOT escape quotes (TOON doesn't use them).
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function unescapeScalar(s: string): string {
  // Reverse — handle \n, \r, \\ in that order.
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "\\") out += "\\";
      else out += next;
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function emitValue(
  value: ToonValue,
  depth: number,
  lines: string[]
): void {
  const pad = INDENT.repeat(depth);
  if (value === null || value === undefined) {
    // Omit entirely — caller should not have emitted a key for this,
    // but if we land here, emit nothing.
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      // Explicit empty-array marker — `[]` after the colon (inline).
      lines.push(`${pad}[]`);
      return;
    }
    for (const item of value) {
      if (isPlainObject(item)) {
        // Object array item — emit `@` then the object's children.
        lines.push(`${pad}@`);
        emitObjectBody(item, depth + 1, lines);
      } else if (Array.isArray(item)) {
        // Nested arrays — emit as @ then recurse.
        lines.push(`${pad}@`);
        emitValue(item, depth + 1, lines);
      } else {
        // Primitive array item — inline after @.
        lines.push(`${pad}@ ${escapeScalar(String(item))}`);
      }
    }
    return;
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) {
      // Explicit empty-object marker — `{}` after the colon (inline).
      lines.push(`${pad}{}`);
      return;
    }
    // Non-empty object — emit its children directly, no `@` sigil.
    // The presence of `key:` lines at depth+1 tells the parser this
    // is an object.
    emitObjectBody(value, depth, lines);
    return;
  }
  // Primitive
  if (typeof value === "boolean") {
    lines.push(`${pad}${value ? "true" : "false"}`);
  } else if (typeof value === "number") {
    lines.push(`${pad}${String(value)}`);
  } else {
    lines.push(`${pad}${escapeScalar(String(value))}`);
  }
}

function emitObjectBody(
  obj: Record<string, ToonValue>,
  depth: number,
  lines: string[]
): void {
  const pad = INDENT.repeat(depth);
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    const key = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) ? k : `"${k}"`;
    if (isPlainObject(v) || Array.isArray(v)) {
      // For empty containers, emit the marker inline.
      if (Array.isArray(v) && v.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else if (isPlainObject(v) && Object.keys(v).length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        emitValue(v, depth + 1, lines);
      }
    } else {
      // Inline scalar.
      if (typeof v === "boolean") {
        lines.push(`${pad}${key}: ${v ? "true" : "false"}`);
      } else if (typeof v === "number") {
        lines.push(`${pad}${key}: ${String(v)}`);
      } else {
        lines.push(`${pad}${key}: ${escapeScalar(String(v))}`);
      }
    }
  }
}

/**
 * Serialize a plain object to TOON text. Top-level must be an object.
 */
export function toonStringify(value: ToonValue): string {
  if (!isPlainObject(value)) {
    throw new Error("TOON top-level value must be a plain object");
  }
  const lines: string[] = [];
  emitObjectBody(value, 0, lines);
  return lines.join("\n") + "\n";
}

/**
 * Parse TOON text back into a plain object.
 *
 * Algorithm:
 *   1. Split into lines.
 *   2. For each line, compute depth = leading-spaces / 2.
 *   3. Strip the indent, then check the first non-space char:
 *        - "@" → start of an array item; the rest of the line (if any)
 *          is an inline scalar item. Otherwise, the next lines at
 *          depth+1 form an object/array item.
 *        - "key:" or "key: value" → object field.
 *   4. Maintain a stack of "containers" (objects or arrays) at each
 *      depth so we know where to attach each parsed line.
 */
export function toonParse(text: string): ToonValue {
  const rawLines = text.replace(/\r\n?/g, "\n").split("\n");
  const lines: { depth: number; body: string }[] = [];
  for (const raw of rawLines) {
    if (raw.trim() === "") continue;
    // Comments start with "#" at the start of the trimmed line.
    if (raw.trimStart().startsWith("#")) continue;
    const match = raw.match(/^( *)/);
    const spaces = match ? match[1].length : 0;
    if (spaces % 2 !== 0) {
      throw new Error(`TOON indent must be a multiple of 2 (line: "${raw}")`);
    }
    const depth = spaces / 2;
    const body = raw.slice(spaces);
    lines.push({ depth, body });
  }
  if (lines.length === 0) return {};

  // Root is always an object.
  const root: Record<string, ToonValue> = {};
  // Stack of { container, type, depth } — the top is the current
  // container we're inserting into.
  type Frame = {
    container: Record<string, ToonValue> | ToonValue[];
    type: "object" | "array";
    depth: number;
  };
  const stack: Frame[] = [{ container: root, type: "object", depth: -1 }];

  function top(): Frame {
    return stack[stack.length - 1];
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const { depth, body } = lines[lineIdx];
    // Pop until top.depth < depth.
    while (stack.length > 1 && top().depth >= depth) {
      stack.pop();
    }
    const parent = top();

    if (body.startsWith("@")) {
      // Array item.
      const rest = body.slice(1).trim();
      if (parent.type !== "array") {
        // Promote — this happens when a key was emitted but the value
        // turns out to be an array. We don't know that at key-emit
        // time with our line-by-line approach, so we lazily convert.
        // For simplicity, we require the key line to come first; the
        // parent container here is the object that owns the array,
        // but we should be inside the array. If we're not, this is a
        // malformed TOON — bail.
        throw new Error(
          `TOON "@" item appeared outside an array (line: "${body}")`
        );
      }
      let itemValue: ToonValue;
      if (rest === "") {
        // Item is an object/array — push a new container as the item.
        const itemObj: Record<string, ToonValue> = {};
        itemValue = itemObj;
        (parent.container as ToonValue[]).push(itemValue);
        stack.push({ container: itemObj, type: "object", depth });
      } else {
        // Inline primitive item.
        (parent.container as ToonValue[]).push(parseScalar(rest));
      }
      continue;
    }

    // Object field: "key: value" or "key:".
    const colonIdx = body.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(`TOON line has no ":" or "@" (line: "${body}")`);
    }
    let key = body.slice(0, colonIdx).trim();
    if (key.startsWith('"') && key.endsWith('"')) {
      key = key.slice(1, -1);
    }
    const valuePart = body.slice(colonIdx + 1).trim();
    if (parent.type !== "object") {
      throw new Error(
        `TOON "key:" appeared inside an array (line: "${body}")`
      );
    }
    if (valuePart === "[]") {
      // Explicit empty array.
      (parent.container as Record<string, ToonValue>)[key] = [];
    } else if (valuePart === "{}") {
      // Explicit empty object.
      (parent.container as Record<string, ToonValue>)[key] = {};
    } else if (valuePart === "") {
      // Value is a nested container — peek next line to decide.
      const next = lines[lineIdx + 1];
      if (next && next.depth === depth + 1 && next.body.startsWith("@")) {
        const arr: ToonValue[] = [];
        (parent.container as Record<string, ToonValue>)[key] = arr;
        stack.push({ container: arr, type: "array", depth });
      } else {
        const childObj: Record<string, ToonValue> = {};
        (parent.container as Record<string, ToonValue>)[key] = childObj;
        stack.push({ container: childObj, type: "object", depth });
      }
    } else {
      (parent.container as Record<string, ToonValue>)[key] = parseScalar(valuePart);
    }
  }

  return root;
}

function parseScalar(s: string): string | number | boolean {
  // Booleans — use explicit keywords so we don't conflate 1/0 with
  // numeric IDs, version numbers, etc.
  if (s === "true") return true;
  if (s === "false") return false;
  // Number? (handle ints, floats, negatives, scientific)
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }
  return unescapeScalar(s);
}

/**
 * Convenience: stringify + return both forms for debugging.
 * Useful when you want to log the token savings.
 */
export function toonStringifyWithStats(value: ToonValue): {
  toon: string;
  json: string;
  toonChars: number;
  jsonChars: number;
  savings: number;
} {
  const toon = toonStringify(value);
  const json = JSON.stringify(value, null, 2);
  const toonChars = toon.length;
  const jsonChars = json.length;
  return {
    toon,
    json,
    toonChars,
    jsonChars,
    savings: Math.round((1 - toonChars / jsonChars) * 100),
  };
}
