import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { ensureDir, pathExists, readJson, writeJson } from "./utils.mjs";

const OFFICIAL_SKILLS = new Set(["org-memory-use", "org-memory-capture"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function manifestHash(skills) {
  return sha256(skills
    .map((skill) => `${skill.name}:${skill.sha256}`)
    .sort()
    .join("\n"));
}

function homeDir(options = {}) {
  return path.resolve(options.homeDir ?? os.homedir());
}

function statePath(options = {}) {
  return path.join(homeDir(options), ".monkeys-memory", "agent-installation.json");
}

function allowedApiOrigin(options = {}) {
  const source = options.skillUpdateOrigin ?? process.env.MONKEYS_MEMORY_OSS_SKILL_ORIGIN;
  if (!source) return null;
  return new URL(source).origin;
}

function validateOfficialUrl(value, options = {}) {
  const url = new URL(value);
  if (!["https:", "file:"].includes(url.protocol) && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`skill update URL must use HTTPS: ${url.href}`);
  }
  const allowedOrigin = allowedApiOrigin(options);
  if (url.protocol !== "file:" && allowedOrigin && url.origin !== allowedOrigin) {
    throw new Error(`skill update URL is outside the configured API origin: ${url.origin}`);
  }
  if (url.protocol !== "file:" && !allowedOrigin) {
    throw new Error("MONKEYS_MEMORY_OSS_SKILL_ORIGIN is required for remote OSS skill updates");
  }
  return url;
}

function validateSkill(skill) {
  if (!skill || typeof skill !== "object") throw new Error("invalid skill manifest item");
  if (!OFFICIAL_SKILLS.has(skill.name)) throw new Error(`unsupported skill update: ${skill.name}`);
  if (skill.path !== `${skill.name}/SKILL.md`) throw new Error(`invalid skill path: ${skill.path}`);
  if (!/^[a-f0-9]{64}$/.test(skill.sha256 ?? "")) throw new Error(`invalid sha256 for skill: ${skill.name}`);
}

async function atomicWrite(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, value);
  await fs.rename(tempPath, filePath);
}

async function ensureInstallationState(options = {}) {
  const filePath = statePath(options);
  if (await pathExists(filePath)) return readJson(filePath);
  const state = {
    schema_version: 1,
    installation_id: `mmi_${crypto.randomUUID()}`,
    created_at: new Date().toISOString(),
  };
  await writeJson(filePath, state);
  return state;
}

async function readInstalledSkillHash(skillName, options = {}) {
  const roots = [
    path.join(homeDir(options), ".codex", "skills"),
    path.join(homeDir(options), ".claude", "skills"),
  ];
  for (const root of roots) {
    const filePath = path.join(root, skillName, "SKILL.md");
    if (await pathExists(filePath)) return sha256(await fs.readFile(filePath));
  }
  return null;
}

export async function getAgentCapabilities(options = {}) {
  const state = await ensureInstallationState(options);
  const skills = {};
  for (const name of OFFICIAL_SKILLS) {
    skills[name] = { sha256: await readInstalledSkillHash(name, options) };
  }
  return {
    installation_id: state.installation_id,
    skills,
  };
}

export async function buildLocalSkillManifest(projectRoot) {
  const skills = [];
  for (const name of OFFICIAL_SKILLS) {
    const filePath = path.join(projectRoot, "skills", name, "SKILL.md");
    const content = await fs.readFile(filePath);
    skills.push({
      name,
      path: `${name}/SKILL.md`,
      url: pathToFileURL(filePath).href,
      sha256: sha256(content),
      bytes: content.byteLength,
    });
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    manifest_hash: manifestHash(skills),
    skills,
  };
}

export async function getLocalSkillUpdateActions(projectRoot, options = {}) {
  const manifest = await buildLocalSkillManifest(projectRoot);
  const capabilities = await getAgentCapabilities(options);
  const outdated = manifest.skills.filter((skill) => capabilities.skills[skill.name]?.sha256 !== skill.sha256);
  if (outdated.length === 0) return [];
  return [{
    id: `local-skill-update-${manifest.manifest_hash.slice(0, 16)}`,
    type: "skill_update",
    scope_type: "installation",
    scope_key: capabilities.installation_id,
    payload: {
      operation: "skill_update",
      schema_version: 1,
      installation_id: capabilities.installation_id,
      manifest_hash: manifest.manifest_hash,
      manifest,
      skills: outdated,
    },
  }];
}

async function fetchManifest(action, options = {}) {
  if (action?.payload?.manifest) {
    const manifest = action.payload.manifest;
    if (manifest?.schema_version !== 1 || !Array.isArray(manifest.skills)) throw new Error("invalid skill manifest");
    if (action.payload.manifest_hash && manifest.manifest_hash !== action.payload.manifest_hash) {
      throw new Error("skill manifest hash does not match the leased action");
    }
    return manifest;
  }
  const manifestUrl = action?.payload?.manifest_url;
  if (!manifestUrl) throw new Error("skill_update action is missing manifest_url");
  const url = validateOfficialUrl(manifestUrl, options);
  if (url.protocol === "file:") {
    const manifest = JSON.parse(await fs.readFile(url, "utf8"));
    if (manifest?.schema_version !== 1 || !Array.isArray(manifest.skills)) throw new Error("invalid skill manifest");
    if (action.payload.manifest_hash && manifest.manifest_hash !== action.payload.manifest_hash) {
      throw new Error("skill manifest hash does not match the leased action");
    }
    return manifest;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`skill manifest download failed (${response.status})`);
  const manifest = await response.json();
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.skills)) throw new Error("invalid skill manifest");
  if (action.payload.manifest_hash && manifest.manifest_hash !== action.payload.manifest_hash) {
    throw new Error("skill manifest hash does not match the leased action");
  }
  return manifest;
}

async function downloadSkill(skill, options = {}) {
  validateSkill(skill);
  const url = validateOfficialUrl(skill.url, options);
  if (url.protocol === "file:") {
    const content = await fs.readFile(url);
    if (sha256(content) !== skill.sha256) throw new Error(`skill checksum mismatch: ${skill.name}`);
    return content;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`skill download failed (${response.status}): ${skill.name}`);
  const content = Buffer.from(await response.arrayBuffer());
  if (sha256(content) !== skill.sha256) throw new Error(`skill checksum mismatch: ${skill.name}`);
  return content;
}

export async function updateSkillsForAction(action, options = {}) {
  const manifest = await fetchManifest(action, options);
  const downloaded = [];
  for (const skill of manifest.skills) {
    downloaded.push({ skill, content: await downloadSkill(skill, options) });
  }

  const targets = [
    path.join(homeDir(options), ".codex", "skills"),
    path.join(homeDir(options), ".claude", "skills"),
  ];
  const updated = [];
  for (const { skill, content } of downloaded) {
    for (const root of targets) {
      if (!(await pathExists(path.dirname(root)))) continue;
      const filePath = path.join(root, skill.path);
      await atomicWrite(filePath, content);
    }
    updated.push({ name: skill.name, sha256: skill.sha256 });
  }

  return {
    schema_version: 1,
    installation_id: (await ensureInstallationState(options)).installation_id,
    manifest_hash: manifest.manifest_hash,
    updated,
  };
}
