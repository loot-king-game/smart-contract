#!/usr/bin/env bash
# First deploy of the program. The hot wallet pays and deploys, then the
# program and IDL upgrade authorities move to the authority signer.
# For an already deployed program use upgrade.sh instead.
#
# Usage: [RPC_URL=<url>] pnpm program:deploy -- devnet|mainnet
source "$(dirname "$0")/lib/env.sh"
parse_cluster "$@"
require_var PROGRAM_KEYPAIR
require_var SIGNER_WALLET
require_var AUTHORITY_PUBKEY
DEPLOY_MAX_SIGN_ATTEMPTS="${DEPLOY_MAX_SIGN_ATTEMPTS:-20}"

require_file "$PROGRAM_KEYPAIR"
require_file "$IDL_FILE"
ACTUAL_PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
if [[ "$ACTUAL_PROGRAM_ID" != "$PROGRAM_ID" ]]; then
  echo "Program keypair $PROGRAM_KEYPAIR is $ACTUAL_PROGRAM_ID, expected $PROGRAM_ID." >&2
  exit 1
fi

if solana program show "$PROGRAM_ID" --url "$RPC" >/dev/null 2>&1; then
  echo "Program $PROGRAM_ID already exists on $CLUSTER. Use: pnpm program:upgrade -- $CLUSTER" >&2
  exit 1
fi

echo "Cluster:       $CLUSTER"
echo "RPC:           $(masked_rpc)"
echo "Program ID:    $PROGRAM_ID"
echo "Hot wallet:    $(solana-keygen pubkey "$HOT_WALLET")"
echo "Authority:     $AUTHORITY_PUBKEY"

verifiable_build
confirm "Deploy $PROGRAM_SO to $CLUSTER?" || exit 1

solana program deploy "$PROGRAM_SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "$HOT_WALLET" \
  --keypair "$HOT_WALLET" \
  --url "$RPC" \
  --use-rpc \
  --max-sign-attempts "$DEPLOY_MAX_SIGN_ATTEMPTS"

anchor idl init --filepath "$IDL_FILE" "$PROGRAM_ID" \
  --provider.cluster "$RPC" \
  --provider.wallet "$HOT_WALLET"

anchor idl set-authority \
  --program-id "$PROGRAM_ID" \
  --new-authority "$AUTHORITY_PUBKEY" \
  --provider.cluster "$RPC" \
  --provider.wallet "$HOT_WALLET"

solana program set-upgrade-authority "$PROGRAM_ID" \
  --upgrade-authority "$HOT_WALLET" \
  --new-upgrade-authority "$SIGNER_WALLET" \
  --keypair "$HOT_WALLET" \
  --url "$RPC"

ONCHAIN_HASH="$(onchain_hash)"
echo "On-chain hash: $ONCHAIN_HASH"
if [[ "$LOCAL_HASH" != "$ONCHAIN_HASH" ]]; then
  echo "Hash mismatch after deploy." >&2
  exit 1
fi

echo "Deployed. Next steps:"
echo "  pnpm game:setup -- $CLUSTER"
echo "  pnpm game-authority:accept -- $CLUSTER"
echo "  pnpm verify -- $CLUSTER all"
