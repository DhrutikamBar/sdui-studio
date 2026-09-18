import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFigmaSelection } from "../lib/figma-input.ts";
import { convertSelectedNode } from "../packages/converter-engine/src/index.ts";
import { validateFlexflowDocument } from "../lib/validate.ts";

test("Figma design URL supplies file key and normalizes URL node ID", () => {
  assert.deepEqual(
    parseFigmaSelection("https://www.figma.com/design/AbCdEf123456/Wallet?node-id=12-34", ""),
    { fileKey: "AbCdEf123456", nodeId: "12:34" }
  );
  assert.deepEqual(parseFigmaSelection("AbCdEf123456", "12:34"), { fileKey: "AbCdEf123456", nodeId: "12:34" });
});

test("Figma selection rejects unrelated hosts and missing nodes", () => {
  assert.throws(() => parseFigmaSelection("https://figma.com.evil.test/design/AbCdEf123456/X?node-id=1-2", ""));
  assert.throws(() => parseFigmaSelection("https://www.figma.com/design/AbCdEf123456/X", ""));
});

test("selected Figma frame converts into a portal-valid JSON tree", () => {
  const { document, warnings } = convertSelectedNode({
    id: "1:2", name: "Wallet", type: "FRAME", layoutMode: "VERTICAL",
    children: [{ id: "1:3", name: "Balance", type: "TEXT", characters: "Balance" }]
  });
  assert.deepEqual(validateFlexflowDocument(document), []);
  assert.equal(document.type, "column");
  assert.equal(document.children[0].props.value, "Balance");
  assert.deepEqual(warnings, []);
});

