import assert from "node:assert/strict";
import test from "node:test";
import { parseD1FileResult } from "../scripts/nationwide-publish-run";

const success = (rowsWritten = 0) => ({
  results: [{ "Rows read": 986049, "Rows written": rowsWritten }],
  success: true,
  finalBookmark: "0000002a-00000004-00005102-example",
  meta: {
    rows_read: 986049,
    rows_written: rowsWritten,
    duration: 1510.732,
    // D1 import metadata can report changed_db=true for SELECT-only files.
    // Completed success and finite row counts determine transport acceptance.
    changed_db: true,
  },
});
const uploadProgress = [
  "├ Checking if file needs uploading",
  "│",
  "├ 🌀 Uploading fe55176f-43e7-4b79-82c2-02884e4161a0.1a2e3f3a05911f79.sql",
  "│ 🌀 Uploading complete.",
  "│",
  "",
].join("\n");

test("accepts actual Wrangler upload-spinner output before completed JSON", () => {
  assert.equal(
    parseD1FileResult(uploadProgress + JSON.stringify([success()], null, 2)),
    0,
  );
  assert.equal(
    parseD1FileResult(
      uploadProgress.replaceAll("\n", "\r\n") +
        JSON.stringify([success(67)], null, 2),
    ),
    67,
  );
});

test("accepts unprefixed completed JSON array or object with finite counts", () => {
  assert.equal(parseD1FileResult(JSON.stringify(success(7))), 7);
  assert.equal(parseD1FileResult(JSON.stringify([success(7), success(4)])), 11);
});

test("does not skip failure objects, unknown output, or trailing errors", () => {
  for (const text of [
    "Error: failed upload\n" + JSON.stringify([success(7)]),
    "├ Error: failed upload\n" + JSON.stringify([success(7)]),
    '{"error":"denied"}\n' + JSON.stringify([success(7)]),
    JSON.stringify([success(7)]) + "\nError: result incomplete",
    JSON.stringify([success(7), { success: false, error: "failed" }]),
    JSON.stringify({ ...success(7), success: false }),
    JSON.stringify({ ...success(7), error: "failed" }),
    JSON.stringify({ ...success(7), errors: ["failed"] }),
    "[]",
    "null",
    uploadProgress,
  ])
    assert.throws(() => parseD1FileResult(text));
});

test("rejects missing success, completion bookmark, results, or trustworthy metadata", () => {
  for (const field of ["success", "meta", "finalBookmark", "results"]) {
    const value: Record<string, unknown> = success();
    delete value[field];
    assert.throws(() => parseD1FileResult(JSON.stringify(value)), field);
  }
  for (const field of ["rows_read", "rows_written", "duration"]) {
    for (const number of [undefined, null, "0", -1, Infinity, NaN]) {
      const value = success();
      (value.meta as Record<string, unknown>)[field] = number;
      assert.throws(() => parseD1FileResult(JSON.stringify(value)), field);
    }
  }
  for (const rows of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const value = success(rows);
    assert.throws(() => parseD1FileResult(JSON.stringify(value)));
  }
  assert.throws(() =>
    parseD1FileResult(
      JSON.stringify([success(Number.MAX_SAFE_INTEGER), success(1)]),
    ),
  );
});

test("accepts Wrangler's already-uploaded progress on a resumed file import", () => {
  assert.equal(
    parseD1FileResult(
      "├ Checking if file needs uploading\n│\n🌀 File already uploaded. Processing.\n" +
        JSON.stringify([success(0)], null, 2),
    ),
    0,
  );
});
