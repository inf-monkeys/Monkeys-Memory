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

async function createTargetRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "target-repo-"));
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await fs.writeFile(path.join(dir, "README.md"), "# Test\n");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
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

test("target-repo CLAUDE.md template exists", async () => {
  const templatePath = path.join(import.meta.dirname, "..", "templates", "target-repo-CLAUDE.md");
  const content = await fs.readFile(templatePath, "utf8");
  assert.ok(content.includes("retrieve"));
  assert.ok(content.includes("capture"));
  assert.ok(content.includes("ALWAYS"));
});
