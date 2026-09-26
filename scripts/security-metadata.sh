#!/usr/bin/env bash
# Writes security.json to the program's "security" metadata account.
# The metadata authority is the program upgrade authority (authority signer), so the
# transaction is exported and signed through send-tx.ts.
# source_revision is filled with COMMIT (default: HEAD).
#
# Usage: [RPC_URL=<url>] pnpm metadata:security -- devnet|mainnet
source "$(dirname "$0")/lib/env.sh"
parse_cluster "$@"
require_var AUTHORITY_PUBKEY
COMMIT="${COMMIT:-$(git rev-parse HEAD)}"
PROGRAM_METADATA="${PROGRAM_METADATA:-@solana-program/program-metadata@0.6.1}"

work="$(mktemp -d -t loot-king-metadata)"
trap 'rm -rf "$work"' EXIT

node -e '
  const fs = require("fs");
  const data = JSON.parse(fs.readFileSync("security.json", "utf8"));
  data.source_revision = process.argv[1];
  fs.writeFileSync(process.argv[2], JSON.stringify(data, null, 2));
' "$COMMIT" "$work/security.json"

echo "Program:  $PROGRAM_ID"
echo "Revision: $COMMIT"
echo "RPC:      $(masked_rpc)"
cat "$work/security.json"
confirm "Write this security metadata with authority $AUTHORITY_PUBKEY?" || exit 1

pnpm -s dlx "$PROGRAM_METADATA" write security "$PROGRAM_ID" "$work/security.json" \
  --rpc "$RPC" \
  --export "$AUTHORITY_PUBKEY" \
  --export-encoding base64 \
  | grep -E '^[A-Za-z0-9+/=]{100,}$' > "$work/txs"

if [[ ! -s "$work/txs" ]]; then
  echo "program-metadata exported no transactions." >&2
  exit 1
fi
TX_FILE="$work/txs" pnpm -s tsx scripts/send-tx.ts "$CLUSTER"
