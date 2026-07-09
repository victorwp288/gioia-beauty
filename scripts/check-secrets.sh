#!/bin/sh
set -eu

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is required (verified with 8.30.1)" >&2
  exit 1
fi

gitleaks dir . --config .gitleaks.toml --no-banner --redact
gitleaks git . --config .gitleaks.toml --no-banner --redact
