#!/usr/bin/env bash
# OtterSec verified build flow for a program whose upgrade authority is a Ledger.
#
# Usage: RPC_URL=<url> pnpm verify -- devnet|mainnet <step>
#   check   build locally, compare hash with on-chain, check repo is public
#           and the commit is pushed
#   pda     export the verification PDA tx and sign it with the Ledger
#   remote  submit the remote verification job to OtterSec (mainnet only)
#   status  show the uploaded PDA and the remote verification status
#   all     check + pda + remote
#
# COMMIT defaults to the current HEAD, which must be pushed to REPO_URL.
source "$(dirname "$0")/lib/env.sh"
USAGE_EXTRA="check|pda|remote|status|all"
parse_cluster "$@"
STEP="${ARGS[0]:-}"
COMMIT="${COMMIT:-$(git rev-parse HEAD)}"

step_check() {
  echo "Repo:    $REPO_URL"
  echo "Commit:  $COMMIT"
  echo "RPC:     $(masked_rpc)"

  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' "$REPO_URL")"
  if [[ "$status" != "200" ]]; then
    echo "Repo is not publicly reachable (HTTP $status). OtterSec cannot clone private repos." >&2
    exit 1
  fi

  if [[ -n "$(git status --porcelain -- programs Cargo.toml Cargo.lock Anchor.toml rust-toolchain.toml)" ]]; then
    echo "Program sources have uncommitted changes; the verified commit would not match." >&2
    exit 1
  fi

  git fetch --quiet --all
  if ! git branch -r --contains "$COMMIT" | grep -q .; then
    echo "Commit $COMMIT is not pushed to any remote." >&2
    exit 1
  fi

  verifiable_build
  local onchain
  onchain="$(onchain_hash)"
  echo "On-chain hash: $onchain"
  if [[ "$LOCAL_HASH" != "$onchain" ]]; then
    echo "Hash mismatch: local build differs from the deployed program." >&2
    exit 1
  fi
  echo "Hashes match."
}

step_pda() {
  require_solana_verify
  local tx_file
  tx_file="$(mktemp -t loot-king-verify-pda)"
  echo "Exporting verification PDA tx (uploader $LEDGER_PUBKEY)..."
  "$SOLANA_VERIFY" export-pda-tx "$REPO_URL" \
    --program-id "$PROGRAM_ID" \
    --uploader "$LEDGER_PUBKEY" \
    --commit-hash "$COMMIT" \
    --library-name "$LIBRARY_NAME" \
    --base-image "$BASE_IMAGE" \
    --encoding base64 \
    -u "$RPC" \
    | grep -E '^[A-Za-z0-9+/=]{100,}$' > "$tx_file"

  if [[ ! -s "$tx_file" ]]; then
    echo "export-pda-tx produced no transaction." >&2
    exit 1
  fi
  TX_FILE="$tx_file" pnpm -s tsx scripts/ledger-send-tx.ts "$CLUSTER"
  rm -f "$tx_file"
}

step_remote() {
  if [[ "$CLUSTER" != "mainnet" ]]; then
    echo "OtterSec remote verification only supports mainnet." >&2
    exit 1
  fi
  require_solana_verify
  "$SOLANA_VERIFY" remote submit-job \
    --program-id "$PROGRAM_ID" \
    --uploader "$LEDGER_PUBKEY" \
    -u "$RPC"
}

step_status() {
  require_solana_verify
  "$SOLANA_VERIFY" get-program-pda \
    --program-id "$PROGRAM_ID" \
    --signer "$LEDGER_PUBKEY" \
    -u "$RPC" || true
  if [[ "$CLUSTER" == "mainnet" ]]; then
    curl -s "https://verify.osec.io/status/$PROGRAM_ID"
    echo
  fi
}

case "$STEP" in
  check) step_check ;;
  pda) step_pda ;;
  remote) step_remote ;;
  status) step_status ;;
  all)
    step_check
    confirm "Upload verification PDA for commit $COMMIT with Ledger?" || exit 1
    step_pda
    [[ "$CLUSTER" == "mainnet" ]] && step_remote
    ;;
  *) usage_cluster ;;
esac
