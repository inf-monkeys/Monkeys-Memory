import test from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  clearConfigCache,
  confidenceBucket,
  formatError,
  globToRegExp,
  matchGlob,
  normalizeEvidenceType,
  normalizeTaskType,
  normalizeText,
  padLeft,
  padRight,
  slugify,
  specificity,
  uniqueSorted,
} from "../scripts/lib/utils.mjs";

test("normalizeTaskType maps aliases correctly", () => {
  assert.equal(normalizeTaskType("bugfix"), "bugfix");
  assert.equal(normalizeTaskType("bug-fix"), "bugfix");
  assert.equal(normalizeTaskType("bug_fix"), "bugfix");
  assert.equal(normalizeTaskType("bugFix"), "bugfix");
  assert.equal(normalizeTaskType("fix"), "bugfix");
  assert.equal(normalizeTaskType("hotfix"), "hotfix");
  assert.equal(normalizeTaskType("hot-fix"), "hotfix");
  assert.equal(normalizeTaskType("refactor"), "refactor");
  assert.equal(normalizeTaskType("refactoring"), "refactor");
  assert.equal(normalizeTaskType("feature"), "feature");
  assert.equal(normalizeTaskType("feat"), "feature");
  assert.equal(normalizeTaskType("review"), "review");
  assert.equal(normalizeTaskType("code-review"), "review");
  assert.equal(normalizeTaskType(""), "");
  assert.equal(normalizeTaskType(null), "");
  assert.equal(normalizeTaskType("unknown-type"), "unknowntype");
});

test("normalizeEvidenceType maps aliases correctly", () => {
  assert.equal(normalizeEvidenceType("mr"), "mr");
  assert.equal(normalizeEvidenceType("merge-request"), "mr");
  assert.equal(normalizeEvidenceType("merge_request"), "mr");
  assert.equal(normalizeEvidenceType("pr"), "pr");
  assert.equal(normalizeEvidenceType("pull-request"), "pr");
  assert.equal(normalizeEvidenceType("doc"), "doc");
  assert.equal(normalizeEvidenceType("document"), "doc");
  assert.equal(normalizeEvidenceType("incident"), "incident");
  assert.equal(normalizeEvidenceType("inc"), "incident");
  assert.equal(normalizeEvidenceType("commit"), "commit");
  assert.equal(normalizeEvidenceType("sha"), "commit");
  assert.equal(normalizeEvidenceType(""), "");
  assert.equal(normalizeEvidenceType(null), "");
  assert.equal(normalizeEvidenceType("other"), "other");
});

test("globToRegExp handles basic * patterns", () => {
  assert.equal(matchGlob("src/*.js", "src/app.js"), true);
  assert.equal(matchGlob("src/*.js", "src/deep/app.js"), false);
  assert.equal(matchGlob("src/*.js", "src/app.ts"), false);
});

test("globToRegExp handles ** patterns", () => {
  assert.equal(matchGlob("src/**", "src/foo/bar/baz.js"), true);
  assert.equal(matchGlob("**", "anything/at/all"), true);
  assert.equal(matchGlob("src/**/test.js", "src/a/b/test.js"), true);
});

test("globToRegExp handles ? wildcard", () => {
  assert.equal(matchGlob("src/?.js", "src/a.js"), true);
  assert.equal(matchGlob("src/?.js", "src/ab.js"), false);
  assert.equal(matchGlob("src/?.js", "src/.js"), false);
});

test("globToRegExp handles [abc] character sets", () => {
  assert.equal(matchGlob("src/[abc].js", "src/a.js"), true);
  assert.equal(matchGlob("src/[abc].js", "src/b.js"), true);
  assert.equal(matchGlob("src/[abc].js", "src/d.js"), false);
  assert.equal(matchGlob("src/[a-z].js", "src/m.js"), true);
});

test("specificity gives higher scores for more specific patterns", () => {
  const s1 = specificity("**");
  const s2 = specificity("src/**");
  const s3 = specificity("src/settlement/**");
  const s4 = specificity("src/settlement/service.ts");
  assert.ok(s1 < s2);
  assert.ok(s2 < s3);
  assert.ok(s3 < s4);
});

test("specificity gives partial credit for ? and [abc]", () => {
  const s1 = specificity("src/?.js");
  const s2 = specificity("src/a.js");
  assert.ok(s1 < s2);
  assert.ok(s1 > 0);

  const s3 = specificity("src/[abc].js");
  assert.ok(s3 < s2);
  assert.ok(s3 > 0);
});

test("formatError formats error messages", () => {
  const result = formatError("compile", new Error("file not found"));
  assert.equal(result, "[monkeys-memory] compile: file not found");
});

test("formatError handles string errors", () => {
  const result = formatError("capture", "invalid input");
  assert.equal(result, "[monkeys-memory] capture: invalid input");
});

test("globToRegExp handles patterns without path separators", () => {
  assert.equal(matchGlob("*.ts", "app.ts"), true);
  assert.equal(matchGlob("*.ts", "app.js"), false);
});

test("globToRegExp handles nested ** correctly", () => {
  assert.equal(matchGlob("**/test/**", "src/test/unit/foo.js"), true);
  assert.equal(matchGlob("**/test/**", "test/foo.js"), true);
});

test("globToRegExp escapes regex special chars", () => {
  assert.equal(matchGlob("src/app.ts", "src/app.ts"), true);
  assert.equal(matchGlob("src/app.ts", "src/appXts"), false);
});

test("matchGlob handles unclosed bracket as literal", () => {
  assert.equal(matchGlob("src/[broken", "src/[broken"), true);
});

test("padRight and padLeft work correctly", () => {
  assert.equal(padRight("hi", 5), "hi   ");
  assert.equal(padRight("hello", 3), "hello");
  assert.equal(padLeft("42", 5), "   42");
  assert.equal(padLeft("hello", 3), "hello");
});
