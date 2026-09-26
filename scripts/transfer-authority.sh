#!/usr/bin/env bash
# Moves the program upgrade authority and the Anchor IDL authority from the
# hot wallet to the authority signer. Game authority is separate: see game-setup.ts.
#
# Usage: [RPC_URL=<url>] pnpm authority:transfer -- devnet|mainnet
source "$(dirname "$0")/lib/env.sh"
parse_cluster "$@"
require_var SIGNER_WALLET
require_var AUTHORITY_PUBKEY

require_file "$HOT_WALLET"
echo "Cluster:           $CLUSTER"
echo "RPC:               $(masked_rpc)"
echo "Program ID:        $PROGRAM_ID"
echo "Current authority: $(solana-keygen pubkey "$HOT_WALLET")"
echo "New authority:     $AUTHORITY_PUBKEY"

solana program show "$PROGRAM_ID" --url "$RPC"
confirm "Transfer upgrade + IDL authority to $AUTHORITY_PUBKEY?" || exit 1

solana program set-upgrade-authority "$PROGRAM_ID" \
  --upgrade-authority "$HOT_WALLET" \
  --new-upgrade-authority "$SIGNER_WALLET" \
  --keypair "$HOT_WALLET" \
  --url "$RPC"

if anchor idl authority "$PROGRAM_ID" --provider.cluster "$RPC" >/dev/null 2>&1; then
  anchor idl set-authority \
    --program-id "$PROGRAM_ID" \
    --new-authority "$AUTHORITY_PUBKEY" \
    --provider.cluster "$RPC" \
    --provider.wallet "$HOT_WALLET"
else
  echo "No Anchor IDL account found; skipping IDL authority transfer."
fi

solana program show "$PROGRAM_ID" --url "$RPC"
