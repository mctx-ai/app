---
title: Framework API Reference
description: Complete reference for @mctx-ai/mcp-server — all exports, types, and patterns.
---

```bash
npm install @mctx-ai/mcp-server
```

## createServer()

Creates an MCP server instance.

```js
import { createServer } from "@mctx-ai/mcp-server";
const app = createServer();
```

Returns an object with `.tool()`, `.resource()`, `.prompt()`, and `.fetch()` methods.

### app.tool(name, handler)

Register a tool that AI clients can call.

```js
const greet = ({ name, greeting }) => `${greeting}, ${name}!`;
greet.description = "Greets a person";
greet.input = {
  name: T.string({ required: true }),
  greeting: T.string({ default: "Hello" }),
};
app.tool("greet", greet);
```

**Handler contract:**

- Receives parsed arguments as first parameter
- Second parameter `ask` is always `null` (sampling not yet implemented)
- Third parameter `env` is the Cloudflare Workers environment object (`Readonly<Record<string, any>>`), defaults to `{}`
- Returns `string`, `object` (auto-serialized), or MCP content array
- Attach `.description` and `.input` as properties on the function
- Errors are caught and returned as tool error responses with secrets redacted

The `env` parameter gives handlers access to Cloudflare bindings such as D1 databases, KV namespaces, and R2 buckets. When running outside Cloudflare Workers (for example, during local development), `env` is `{}`.

```js
// Accessing a D1 database binding
const lookup = async ({ userId }, _ask, env) => {
  const row = await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(userId).first();
  return row ? row.name : "Not found";
};
lookup.description = "Look up a user name by ID";
lookup.input = { userId: T.string({ required: true }) };
app.tool("lookup", lookup);
```

Binary content types (ImageContent, AudioContent per MCP spec) are planned for a future release.

### app.resource(uri, handler)

Register a resource. Use exact URIs for static resources, URI templates for dynamic ones.

```js
// Static
const readme = () => "Content here";
readme.mimeType = "text/plain";
app.resource("docs://readme", readme);

// Dynamic (RFC 6570 Level 1 template)
const user = ({ userId }) => JSON.stringify({ id: userId });
user.mimeType = "application/json";
app.resource("user://{userId}", user);
```

Resource handlers receive `(params, ask, env)`. For static resources `params` is `{}`. Use `env` to access Cloudflare bindings:

```js
// Dynamic resource backed by KV
const config = async ({ key }, _ask, env) => {
  const value = await env.KV.get(key);
  return value ?? "Not found";
};
config.mimeType = "text/plain";
app.resource("config://{key}", config);
```

### app.prompt(name, handler)

Register a prompt template. Return a string for single-message prompts, or use `conversation()` for multi-message.

```js
// Single message
const review = ({ code }) => `Review: ${code}`;
review.input = { code: T.string({ required: true }) };
app.prompt("code-review", review);

// Multi-message
const debug = ({ error }) =>
  conversation(({ user, ai }) => [user.say(`Debug: ${error}`), ai.say("Analyzing...")]);
debug.input = { error: T.string({ required: true }) };
app.prompt("debug", debug);
```

Prompt handlers receive `(args, ask, env)`. Use `env` to fetch dynamic context from Cloudflare bindings before building the prompt:

```js
// Prompt that loads context from KV
const summarize = async ({ topic }, _ask, env) => {
  const context = await env.KV.get(`context:${topic}`);
  return `Summarize the following about "${topic}":\n\n${context ?? "No context found."}`;
};
summarize.input = { topic: T.string({ required: true }) };
app.prompt("summarize", summarize);
```

### app.fetch(request, env, ctx)

The fetch handler. Compatible with Cloudflare Workers and mctx platform.

```js
export default { fetch: app.fetch };
```

---

## T (Type System)

Defines input schemas for tools and prompts. Produces JSON Schema.

```js
import { T } from "@mctx-ai/mcp-server";
```

### T.string(options?)

| Option        | Type       | Description                    |
| ------------- | ---------- | ------------------------------ |
| `required`    | `boolean`  | Mark as required               |
| `description` | `string`   | Human-readable description     |
| `enum`        | `string[]` | Allowed values                 |
| `default`     | `string`   | Default value                  |
| `minLength`   | `number`   | Minimum length                 |
| `maxLength`   | `number`   | Maximum length                 |
| `pattern`     | `string`   | Regex pattern                  |
| `format`      | `string`   | Format hint (email, uri, etc.) |

### T.number(options?)

| Option        | Type      | Description                |
| ------------- | --------- | -------------------------- |
| `required`    | `boolean` | Mark as required           |
| `description` | `string`  | Human-readable description |
| `min`         | `number`  | Minimum value              |
| `max`         | `number`  | Maximum value              |
| `default`     | `number`  | Default value              |

### T.boolean(options?)

| Option        | Type      | Description                |
| ------------- | --------- | -------------------------- |
| `required`    | `boolean` | Mark as required           |
| `description` | `string`  | Human-readable description |
| `default`     | `boolean` | Default value              |

### T.array(options?)

```js
T.array({ items: T.string() }); // string array
T.array({ items: T.number(), required: true }); // required
```

### T.object(options?)

```js
T.object({
  properties: {
    name: T.string({ required: true }),
    age: T.number(),
  },
});
```

### buildInputSchema(input)

Compiles a `fn.input` object into a JSON Schema `inputSchema` with `required` array. Used internally by the framework — available if you need raw schema generation.

```js
import { buildInputSchema } from "@mctx-ai/mcp-server";

const schema = buildInputSchema({
  name: T.string({ required: true }),
  age: T.number(),
});
// { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } }, required: ['name'] }
```

---

## conversation()

Builds multi-message prompt responses.

```js
import { conversation } from "@mctx-ai/mcp-server";

conversation(({ user, ai }) => [
  user.say("Hello"), // text message
  user.attach(data, "application/json"), // embedded data
  user.embed("image://logo"), // embedded resource
  ai.say("How can I help?"), // AI message
]);
```

---

## createProgress(total?)

Creates a step function for generator-based tools.

```js
import { createProgress } from "@mctx-ai/mcp-server";

const task = function* ({ data }) {
  const step = createProgress(3);
  yield step();
  yield step();
  yield step();
  return "Done";
};
```

Call `createProgress()` without arguments for indeterminate progress. Progress steps are tracked internally. In the current HTTP transport, progress is tracked but not streamed -- the final result is returned when the generator completes.

---

## log

Structured logging with RFC 5424 severity levels.

```js
import { log } from "@mctx-ai/mcp-server";

log.debug("Detailed info");
log.info("Informational");
log.notice("Significant event");
log.warning("Warning");
log.error("Error");
log.critical("Critical");
log.alert("Immediate action needed");
log.emergency("System unusable");
```

Logs are buffered internally. In the current HTTP transport, buffered logs are discarded after each request and are not visible in the dashboard. To write logs that appear in the real-time dashboard logs viewer, use `console.log()`, `console.warn()`, or `console.error()` instead.

---

## Sampling (ask)

All handlers receive a second parameter named `ask` for LLM sampling. Sampling requires bidirectional communication, which is not available in the current HTTP transport.

**`ask` always returns `null` in the current implementation.** Sampling support is not yet implemented.

```js
const smart = async ({ question }, ask, env) => {
  // ask is always null currently -- sampling is not yet implemented
  // env is available for Cloudflare bindings even without sampling
  return `Answer: ${question}`;
};
```

The `ask` parameter is reserved for future streaming transport support. Do not rely on it returning a value.

---

## Security

The framework applies security protections automatically:

- **Error sanitization** — redacts AWS keys, JWTs, connection strings, Bearer tokens, API keys
- **Size limits** — prevents DoS via large request/response bodies
- **URI validation** — blocks `file://`, `javascript:`, `data:` schemes
- **Path traversal** — detects `../` sequences including encoded variants
- **Prototype pollution** — strips `__proto__`, `constructor`, `prototype` keys

These protections are internal and applied automatically. You don't need to configure them.

---

## See Also

- [Getting Started with the Framework](./framework-getting-started.md) — Build your first server in 5 minutes
- [Tools, Resources, and Prompts](/building-mcp-servers/tools-and-resources) — Practical examples and patterns
- [Server Requirements](/building-mcp-servers/server-requirements) — Package structure and deployment checklist
