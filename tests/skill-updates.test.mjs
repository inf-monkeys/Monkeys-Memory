import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { reportAgentActionResult, runAgentActions } from "../scripts/lib/agent-actions.mjs";
import { buildLocalSkillManifest, getAgentCapabilities, getLocalSkillUpdateActions, updateSkillsForAction } from "../scripts/lib/skill-updates.mjs";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("getAgentCapabilities creates a stable installation id and hashes installed skills", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "mm-skills-capabilities-"));
  await fs.mkdir(path.join(homeDir, ".codex", "skills", "org-memory-use"), { recursive: true });
  await fs.writeFile(path.join(homeDir, ".codex", "skills", "org-memory-use", "SKILL.md"), "use skill\n");

  const first = await getAgentCapabilities({ homeDir });
  const second = await getAgentCapabilities({ homeDir });

  assert.equal(first.installation_id, second.installation_id);
  assert.match(first.installation_id, /^mmi_/);
  assert.equal(first.skills["org-memory-use"].sha256, sha256("use skill\n"));
  assert.equal(first.skills["org-memory-capture"].sha256, null);
});

test("local OSS skill manifest detects drift and updates Codex and Claude skills", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mm-oss-skill-source-"));
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "mm-skills-update-"));
  await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
  await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
  const useContent = "# org use\n";
  const captureContent = "# org capture\n";
  await fs.mkdir(path.join(projectRoot, "skills", "org-memory-use"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "skills", "org-memory-capture"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "skills", "org-memory-use", "SKILL.md"), useContent);
  await fs.writeFile(path.join(projectRoot, "skills", "org-memory-capture", "SKILL.md"), captureContent);

  const manifest = await buildLocalSkillManifest(projectRoot);
  assert.deepEqual(manifest.skills.map((skill) => skill.name), ["org-memory-use", "org-memory-capture"]);
  assert.ok(manifest.skills.every((skill) => skill.url.startsWith("file://")));

  const actions = await getLocalSkillUpdateActions(projectRoot, { homeDir });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "skill_update");
  assert.equal(actions[0].payload.manifest.manifest_hash, manifest.manifest_hash);

  const result = await updateSkillsForAction(actions[0], { homeDir });
  assert.equal(result.manifest_hash, manifest.manifest_hash);
  assert.equal(await fs.readFile(path.join(homeDir, ".codex", "skills", "org-memory-use", "SKILL.md"), "utf8"), useContent);
  assert.equal(await fs.readFile(path.join(homeDir, ".claude", "skills", "org-memory-capture", "SKILL.md"), "utf8"), captureContent);
});

test("local OSS skill update actions complete without a remote endpoint", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mm-oss-local-action-"));
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "mm-oss-local-home-"));
  await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "skills", "org-memory-use"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "skills", "org-memory-capture"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "skills", "org-memory-use", "SKILL.md"), "# local use\n");
  await fs.writeFile(path.join(projectRoot, "skills", "org-memory-capture", "SKILL.md"), "# local capture\n");

  const [action] = await getLocalSkillUpdateActions(projectRoot, { homeDir });
  const results = await runAgentActions([action], { homeDir });

  assert.equal(results.length, 1);
  assert.equal(results[0].reported, true);
  assert.equal(results[0].report.local, true);
  assert.equal(await fs.readFile(path.join(homeDir, ".codex", "skills", "org-memory-use", "SKILL.md"), "utf8"), "# local use\n");
});

test("non-local OSS action results require an explicit endpoint", async () => {
  await assert.rejects(
    reportAgentActionResult({ id: "act_remote_1", type: "repo_scan" }, { ok: true }, {}),
    /MONKEYS_MEMORY_AGENT_ACTION_ENDPOINT is required/,
  );
});

test("updateSkillsForAction rejects unconfigured remote origins and checksum mismatches", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "mm-skills-reject-"));
  const skillFile = path.join(homeDir, "skill.md");
  await fs.writeFile(skillFile, "wrong content");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("manifest")) {
      return jsonResponse({
        schema_version: 1,
        manifest_hash: "manifest_1",
        skills: [{
          name: "org-memory-use",
          path: "org-memory-use/SKILL.md",
          url: pathToFileURL(skillFile).href,
          sha256: "a".repeat(64),
        }],
      });
    }
    return new Response("wrong content");
  };

  try {
    await assert.rejects(
      updateSkillsForAction({
        payload: { manifest_url: "https://evil.example.test/api/v1/skills/manifest" },
      }, { homeDir }),
      /MONKEYS_MEMORY_OSS_SKILL_ORIGIN is required/,
    );

    await assert.rejects(
      updateSkillsForAction({
        payload: {
          manifest: {
            schema_version: 1,
            manifest_hash: "manifest_1",
            skills: [{
              name: "org-memory-use",
              path: "org-memory-use/SKILL.md",
              url: pathToFileURL(skillFile).href,
              sha256: "a".repeat(64),
            }],
          },
          manifest_hash: "manifest_1"
        },
      }, { homeDir }),
      /checksum mismatch/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
