import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import vm from "node:vm";

// Execute the real production-compiled page/action with isolated dependencies.
// Source-only tests cannot detect a compiler dropping a closure variable.
const factories = new Map();
for (const file of await readdir(".next/server/chunks/ssr")) {
  if (!file.endsWith(".js")) continue;
  const source = await readFile(`.next/server/chunks/ssr/${file}`, "utf8");
  if (
    !source.includes("approveAuthorization") &&
    !source.includes("connectionRequest")
  )
    continue;
  const chunkModule = { exports: {} };
  vm.runInNewContext(
    source,
    { module: chunkModule },
    { timeout: 1000, filename: file },
  );
  assert.ok(
    Array.isArray(chunkModule.exports),
    "Unsupported production chunk format",
  );
  for (let i = 0; i < chunkModule.exports.length; i++) {
    if (typeof chunkModule.exports[i] === "function")
      factories.set(chunkModule.exports[i - 1], chunkModule.exports[i]);
  }
}
const actionFactories = [...factories.values()].filter((factory) => {
  const source = factory.toString();
  return (
    source.includes(".approveAuthorization)") && source.includes(".checkCsrf)")
  );
});
const pageFactories = [...factories.values()].filter((factory) =>
  factory.toString().includes(".connectionRequest)"),
);
assert.equal(
  actionFactories.length,
  1,
  "Expected one compiled approval action",
);
assert.equal(pageFactories.length, 1, "Expected one compiled connection page");

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = { role: "owner", sessionId: "browser-session", name: "Test" };
const callback = "http://127.0.0.1:43123/callback?code=test&state=test";
let session = actor;
let calls = [];
class DesktopError extends Error {}
class Redirect extends Error {
  constructor(destination) {
    super("redirect");
    this.destination = destination;
  }
}
const imports = {
  getSession: async () => session,
  canUpload: () => true,
  ROLE_LABELS: { owner: "owner" },
  connectionRequest: async (_, id) => {
    assert.equal(id, requestId);
    return { mode: "transient" };
  },
  listOwnDevices: async () => [],
  csrf: (_, action) => {
    assert.equal(action, "connect:" + requestId);
    return "test-csrf";
  },
  checkCsrf: async (current, action, token) => {
    assert.equal(current, actor);
    assert.equal(action, "connect:" + requestId);
    if (token !== "test-csrf") throw new DesktopError("forbidden");
  },
  approveAuthorization: async (...args) => {
    calls.push(args);
    return args[2] === "deny" ? null : callback;
  },
  redirect: (destination) => {
    throw new Redirect(destination);
  },
  DesktopError,
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  registerServerReference: (fn) => fn,
  ensureServerEntryExports: () => {},
  // Reproduce the previous inline closure path as well as explicit bind.
  encryptActionBoundArgs: async (_, ...args) => args,
  decryptActionBoundArgs: async (_, args) => args,
};
function instantiate(factory) {
  const exports = {};
  factory({
    i: () => imports,
    s: (entries) => {
      for (let i = 0; i < entries.length;) {
        const name = entries[i++];
        const kind = entries[i++];
        if (kind === 0) exports[name] = entries[i++];
        else Object.defineProperty(exports, name, { get: kind });
      }
    },
  });
  return exports;
}
const action = instantiate(actionFactories[0]);
imports.submitConnection = action.submitConnection;
const page = instantiate(pageFactories[0]);
const tree = await page.default({
  searchParams: Promise.resolve({ request: requestId }),
});
function findForm(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "form") return node;
  for (const child of [node.props?.children].flat()) {
    const found = findForm(child);
    if (found) return found;
  }
}
const form = findForm(tree);
assert.equal(
  typeof form?.props.action,
  "function",
  "Missing bound form action",
);
for (const decision of ["approve", "deny"]) {
  calls = [];
  const data = new FormData();
  data.set("csrf", "test-csrf");
  data.set("decision", decision);
  data.set("replacement", "replacement-device");
  await assert.rejects(form.props.action(data), (error) => {
    assert.equal(
      error.destination,
      decision === "approve" ? callback : "/desktop/devices",
      error.message,
    );
    return true;
  });
  assert.deepEqual(calls, [[actor, requestId, decision, "replacement-device"]]);
}
for (const scenario of ["no-session", "bad-csrf", "bad-decision"]) {
  calls = [];
  session = scenario === "no-session" ? null : actor;
  const data = new FormData();
  data.set("csrf", scenario === "bad-csrf" ? "wrong" : "test-csrf");
  data.set("decision", scenario === "bad-decision" ? "unexpected" : "approve");
  await assert.rejects(form.props.action(data), (error) => {
    if (scenario === "no-session") assert.equal(error.destination, "/login");
    else
      assert.equal(
        error.message,
        scenario === "bad-csrf" ? "forbidden" : "invalid_request",
      );
    return true;
  });
  assert.equal(calls.length, 0, "Rejected action mutated authorization");
}
console.log(
  "Compiled desktop form: request binding, approval/denial redirects and rejection before mutation passed.",
);
