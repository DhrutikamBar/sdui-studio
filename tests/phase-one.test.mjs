import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionBindingPath } from "../lib/preview-bindings.ts";

test("collection bindings preserve path characters", () => {
  assert.equal(collectionBindingPath("{{transactions}}"), "transactions");
  assert.equal(collectionBindingPath(" {{ item.rows }} "), "item.rows");
  assert.equal(collectionBindingPath(null), "");
});

test("an unconfigured deployment completes the auth check", async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("NEXT_PUBLIC_FIREBASE_")) delete process.env[key];
  }
  const { isFirebaseConfigured, observeStudioUser } = await import("../lib/firebase.ts");
  assert.equal(isFirebaseConfigured, false);
  const observed = [];
  const stop = observeStudioUser((user) => observed.push(user));
  assert.deepEqual(observed, [null]);
  stop();
});
