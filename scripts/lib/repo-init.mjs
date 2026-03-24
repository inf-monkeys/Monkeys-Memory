import path from "node:path";
import { ensureDir, pathExists, writeText } from "./utils.mjs";

async function writePlaceholder(filePath, contents) {
  if (!(await pathExists(filePath))) {
    await writeText(filePath, contents);
  }
}

export function getRepoPaths(projectRoot, memoryRoot, repoName) {
  const repoDir = path.join(projectRoot, memoryRoot, "repos", repoName);
  return {
    repoDir,
    experiencesDir: path.join(repoDir, "experiences"),
    compiledDir: path.join(repoDir, "compiled"),
    designDir: path.join(repoDir, "design"),
    indexDir: path.join(repoDir, "index"),
  };
}

export async function ensureRepoInitialized(projectRoot, memoryRoot, repoName) {
  const {
    repoDir,
    experiencesDir,
    compiledDir,
    designDir,
    indexDir,
  } = getRepoPaths(projectRoot, memoryRoot, repoName);

  await ensureDir(experiencesDir);
  await ensureDir(compiledDir);
  await ensureDir(designDir);
  await ensureDir(indexDir);

  await writePlaceholder(
    path.join(designDir, "README.md"),
    `# ${repoName} Design\n\nThis directory stores repo-specific design notes and generated docs.\n`,
  );

  await writePlaceholder(
    path.join(indexDir, "README.md"),
    `# ${repoName} Index\n\nThis directory stores derived indexes for compiled memory.\n`,
  );

  return {
    repoDir,
    experiencesDir,
    compiledDir,
    designDir,
    indexDir,
  };
}
