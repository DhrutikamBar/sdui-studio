import assert from "node:assert/strict";
import { test } from "node:test";
import { nextVersionNumber, publishedVersionNumber, validateReleaseActions } from "../lib/release-policy.ts";

test("drafts do not advance the published version", () => {
  const oldScreen = { status: "Published", version: 11 };
  assert.equal(nextVersionNumber(oldScreen, 12), 13);
  assert.equal(publishedVersionNumber(oldScreen, 11), 11);
  const draftAfterPublish = { status: "Published", version: 11, publishedVersion: 11, latestDraftVersion: 13, latestVersion: 13 };
  assert.equal(nextVersionNumber(draftAfterPublish), 14);
  assert.equal(publishedVersionNumber(draftAfterPublish), 11);
});

test("legacy drafts recover an earlier published version", () => {
  assert.equal(publishedVersionNumber({ status: "Draft", version: 12 }, 11), 11);
  assert.equal(publishedVersionNumber({ status: "Published", version: 12 }, 0), 0);
});

test("publish policy rejects direct API calls and unapproved URLs", () => {
  const document = { type: "column", children: [
    { type: "button", action: { type: "apiCall", target: "payments" } },
    { type: "button", action: { type: "openUrl", target: "https://unapproved.example/path" } },
  ] };
  const errors = validateReleaseActions(document, ["https://approved.example"]);
  assert.equal(errors.length, 2);
});

test("publish policy accepts approved actions and rejects actions on layouts", () => {
  const approved = { type: "button", action: { type: "openUrl", target: "https://approved.example/path" } };
  assert.deepEqual(validateReleaseActions(approved, ["https://approved.example"]), []);
  assert.equal(validateReleaseActions({ type: "column", action: { type: "back" } }, []).length, 1);
});
