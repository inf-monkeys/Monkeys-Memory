#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
CODEX_SKILLS_DIR="${HOME}/.codex/skills"
MONKEYS_MEMORY_HOME="${HOME}/.monkeys-memory"
MONKEYS_MEMORY_BIN_DIR="${MONKEYS_MEMORY_HOME}/bin"
LOCAL_MEMORY_ROOT="${REPO_ROOT}/.monkeys-memory"
LOCAL_MEMORY_ORG_DIR="${LOCAL_MEMORY_ROOT}/org"
LOCAL_ALLOWLIST_PATH="${LOCAL_MEMORY_ORG_DIR}/repo-allowlist.json"
DEFAULT_ORG="default-org"
ENABLE_HOOKS=1
HOOKS_STATUS="disabled"

usage() {
  echo "Usage: ./install.sh [--no-hooks]"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-hooks)
      ENABLE_HOOKS=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required to install monkeys-memory." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install monkeys-memory." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  echo "Node.js 22+ is required to install monkeys-memory. Found $(node -v)." >&2
  exit 1
fi

CONFIG_ORG="$(node -e 'const fs = require("fs"); const path = require("path"); try { const config = JSON.parse(fs.readFileSync(path.join(process.argv[1], "memory.config.json"), "utf8")); process.stdout.write(config.org || ""); } catch { process.stdout.write(""); }' "${REPO_ROOT}")"
if [ -n "${CONFIG_ORG}" ]; then
  DEFAULT_ORG="${CONFIG_ORG}"
fi

mkdir -p "${CODEX_SKILLS_DIR}"
mkdir -p "${MONKEYS_MEMORY_BIN_DIR}"
mkdir -p "${LOCAL_MEMORY_ORG_DIR}"

if [ ! -f "${LOCAL_ALLOWLIST_PATH}" ]; then
  cat > "${LOCAL_ALLOWLIST_PATH}" <<EOF
{
  "version": 1,
  "org": "${DEFAULT_ORG}",
  "repos": []
}
EOF
fi

ln -sfn "${REPO_ROOT}/skills/org-memory-use" "${CODEX_SKILLS_DIR}/org-memory-use"
ln -sfn "${REPO_ROOT}/skills/org-memory-capture" "${CODEX_SKILLS_DIR}/org-memory-capture"
ln -sfn "${REPO_ROOT}" "${MONKEYS_MEMORY_HOME}/repo"
ln -sfn "${REPO_ROOT}/bin/monkeys-memory" "${MONKEYS_MEMORY_BIN_DIR}/monkeys-memory"

# Claude Code integration
CLAUDE_CODE_STATUS="not-detected"
CLAUDE_DIR="${HOME}/.claude"
if [ -d "${CLAUDE_DIR}" ]; then
  CLAUDE_COMMANDS_DIR="${CLAUDE_DIR}/commands"
  mkdir -p "${CLAUDE_COMMANDS_DIR}"

  cat > "${CLAUDE_COMMANDS_DIR}/monkeys-memory-retrieve.md" <<CCEOF
# Retrieve team memory for the current repo
bash "\$HOME/.monkeys-memory/bin/monkeys-memory" retrieve --workspace "\$(pwd)" --task \$ARGUMENTS
CCEOF

  cat > "${CLAUDE_COMMANDS_DIR}/monkeys-memory-capture.md" <<CCEOF
# Capture a new experience for the current repo
bash "\$HOME/.monkeys-memory/bin/monkeys-memory" capture --workspace "\$(pwd)" \$ARGUMENTS
CCEOF

  cat > "${CLAUDE_COMMANDS_DIR}/monkeys-memory-status.md" <<CCEOF
# Show monkeys-memory status
bash "\$HOME/.monkeys-memory/bin/monkeys-memory" status
CCEOF

  cp "${REPO_ROOT}/CLAUDE.md" "${MONKEYS_MEMORY_HOME}/CLAUDE.md"
  CLAUDE_CODE_STATUS="installed"
fi

if [ "${ENABLE_HOOKS}" -eq 1 ]; then
  if git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "${REPO_ROOT}" config core.hooksPath .githooks
    HOOKS_STATUS="enabled"
  else
    HOOKS_STATUS="missing-git"
  fi
else
  HOOKS_STATUS="skipped"
fi

(cd "${REPO_ROOT}" && npm run compile)

echo "Installed Codex skills:"
echo "  - ${CODEX_SKILLS_DIR}/org-memory-use"
echo "  - ${CODEX_SKILLS_DIR}/org-memory-capture"
echo
echo "Claude Code integration:"
if [ "${CLAUDE_CODE_STATUS}" = "installed" ]; then
  echo "  - commands installed to ${CLAUDE_DIR}/commands/"
  echo "  - CLAUDE.md copied to ${MONKEYS_MEMORY_HOME}/CLAUDE.md"
  echo "  - use /monkeys-memory-retrieve and /monkeys-memory-capture in Claude Code"
else
  echo "  - ~/.claude not detected; skipped"
  echo "  - install Claude Code first, then rerun ./install.sh"
fi
echo
echo "Installed command:"
echo "  - ${MONKEYS_MEMORY_BIN_DIR}/monkeys-memory"
echo "Git hooks:"
if [ "${HOOKS_STATUS}" = "enabled" ]; then
  echo "  - enabled by default for this repo"
  echo "  - core.hooksPath -> ${REPO_ROOT}/.githooks"
  echo "  - active hook: ${REPO_ROOT}/.githooks/post-merge"
elif [ "${HOOKS_STATUS}" = "missing-git" ]; then
  echo "  - requested by default, but skipped because this install source is not a git checkout"
  echo "  - clone the repo with git, then rerun ./install.sh to enable hooks"
else
  echo "  - skipped (--no-hooks)"
  echo "  - rerun ./install.sh without --no-hooks to enable later"
fi
echo "Initialized local memory data:"
echo "  - ${LOCAL_ALLOWLIST_PATH}"
echo "Next step:"
echo "  - add repo directory names to ${LOCAL_ALLOWLIST_PATH}"
echo "  - memory activates automatically the next time you work in an allowlisted repo"
echo
echo "Ready."
echo "Open a repo session; the skills can now call retrieve/capture via:"
echo "  bash ${MONKEYS_MEMORY_BIN_DIR}/monkeys-memory"
echo
echo "If you want it on PATH, add this once:"
echo "  export PATH=\"${MONKEYS_MEMORY_BIN_DIR}:\$PATH\""
