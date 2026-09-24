#!/usr/bin/env bash
# Deterministic build + hash comparison against the deployed program.
# Usage: [RPC_URL=<url>] pnpm build:verifiable [-- devnet|mainnet]
source "$(dirname "$0")/lib/env.sh"

if [[ "${1:-}" == "--" ]]; then shift; fi

verifiable_build

if [[ -n "${1:-}" ]]; then
  parse_cluster "$@"
  ONCHAIN_HASH="$(onchain_hash)"
  echo "On-chain hash ($CLUSTER): $ONCHAIN_HASH"
  if [[ "$LOCAL_HASH" != "$ONCHAIN_HASH" ]]; then
    echo "Hash mismatch." >&2
    exit 1
  fi
  echo "Hashes match."
fi
