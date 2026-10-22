#!/usr/bin/env bash
# Start a Cloudflare quick tunnel to the local Vellum route host.
#
# cloudflared prints a public HTTPS URL (https://<name>.trycloudflare.com).
# That URL replaces the velay.vellum.ai base URL in VoiceView.swift.
# Set VoiceView's endpoint to <printed-url>/x/voice before running the app.
#
# Origin is the ingress service in cloudflared-config.yml (http://localhost:3000).
# Quick Tunnels print a trycloudflare.com URL only when --url is passed, and they
# do not use a credentials file. This script does not pass --config, so cloudflared
# will not look for a named-tunnel token. No API key is read from the repo.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${ROOT}/cloudflared-config.yml"
ORIGIN="$(awk '/^[[:space:]]*-[[:space:]]*service:[[:space:]]*http/{print $3; exit}' "${CONFIG}")"

if [[ -z "${ORIGIN}" ]]; then
  echo "No http:// service found in ${CONFIG}" >&2
  exit 1
fi

echo "Tunneling ${ORIGIN}"
echo "The public HTTPS URL cloudflared prints replaces the velay.vellum.ai base URL in VoiceView.swift."
echo "Set the VoiceView endpoint to <printed-url>/x/voice"

exec cloudflared tunnel --url "${ORIGIN}"
