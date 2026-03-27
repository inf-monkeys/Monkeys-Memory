import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { addRepoToAllowlist, clearAllowlistCache, getAllowedRepos } from "../scripts/lib/allowlist.mjs";
import { clearConfigCache, pathExists } from "../scripts/lib/utils.mjs";

const execFileAsync = promisify(execFile);

async function createMemoryRoot() {
  clearConfigCache();
  clearAllowlistCache();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-init-"));
  await fs.writeFile(path.join(root, "memory.config.json"), JSON.stringify({
    org: "test-org",
    memoryRoot: ".monkeys-memory",
    onboardingRuleLimit: 10,
    runtimeRuleLimit: 5,
  }, null, 2) + "\n");
  await fs.mkdir(path.join(root, ".monkeys-memory", "org"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".monkeys-memory", "org", "repo-allowlist.json"),
    JSON.stringify({ version: 1, org: "test-org", repos: [] }, null, 2) + "\n",
  );
  return root;
}

test("addRepoToAllowlist adds new repos", async () => {
  const root = await createMemoryRoot();
  const added = await addRepoToAllowlist(root, "new-repo");
  assert.equal(added, true);

  clearAllowlistCache();
  const repos = await getAllowedRepos(root);
  assert.ok(repos.includes("new-repo"));
});

test("addRepoToAllowlist skips duplicate repos", async () => {
  const root = await createMemoryRoot();
  await addRepoToAllowlist(root, "dup-repo");
  clearAllowlistCache();
  const added = await addRepoToAllowlist(root, "dup-repo");
  assert.equal(added, false);
});

test("post-commit hook template exists and is valid", async () => {
  const templatePath = path.join(import.meta.dirname, "..", "templates", "post-commit-hook.sh");
  const content = await fs.readFile(templatePath, "utf8");
  assert.ok(content.includes("monkeys-memory"));
  assert.ok(content.includes("capture --auto"));
  assert.ok(content.startsWith("#!/usr/bin/env bash"));
});

test("skills exist for both org-memory-use and org-memory-capture", async () => {
  const useSkill = path.join(import.meta.dirname, "..", "skills", "org-memory-use", "SKILL.md");
  const captureSkill = path.join(import.meta.dirname, "..", "skills", "org-memory-capture", "SKILL.md");
  assert.ok(await pathExists(useSkill));
  assert.ok(await pathExists(captureSkill));

  const useContent = await fs.readFile(useSkill, "utf8");
  const captureContent = await fs.readFile(captureSkill, "utf8");
  assert.ok(useContent.includes("name: org-memory-use"));
  assert.ok(captureContent.includes("name: org-memory-capture"));
  assert.ok(useContent.includes("retrieve"));
  assert.ok(captureContent.includes("capture"));
});
