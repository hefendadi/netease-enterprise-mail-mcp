#!/usr/bin/env bash
# Install dependencies and create a fictional configuration template only.
set -euo pipefail

command -v node >/dev/null 2>&1 || { echo 'Node.js >=20.19.0 is required.' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'npm is required.' >&2; exit 1; }
node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  console.error("Node.js >=20.19.0 is required; found " + process.version);
  process.exit(1);
}
'

project_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$project_dir"
npm ci --no-audit --no-fund

if [ ! -e .env ] && [ ! -L .env ]; then
  (umask 077; cp .env.example .env)
  echo 'Created .env with fictional placeholders. Replace them with your own credentials.'
else
  echo 'Existing .env preserved.'
fi

echo 'Dependencies installed. Follow README.md to register this server manually in your MCP client.'
echo 'No mailbox connection was attempted and no client configuration was changed.'
