#!/usr/bin/env bash
# Upgrade of a program whose upgrade authority is the Ledger. The hot wallet
# writes the buffer; the Ledger signs only the final upgrade transaction.
# A fresh buffer keypair is generated for each run (override BUFFER_KEYPAIR).
#
# Usage: [RPC_URL=<url>] pnpm upgrade:ledger -- devnet|mainnet
# Afterwards: update idl/loot_king.json if the interface changed
# (pnpm idl:check), then re-run pnpm verify for the new commit.
source "$(dirname "$0")/lib/env.sh"
parse_cluster "$@"
WRITE_BUFFER_MAX_SIGN_ATTEMPTS="${WRITE_BUFFER_MAX_SIGN_ATTEMPTS:-10}"

if [[ -z "${BUFFER_KEYPAIR:-}" ]]; then
  mkdir -p .keys
  BUFFER_KEYPAIR=".keys/buffer-$(date +%Y%m%d-%H%M%S).json"
  solana-keygen new --no-bip39-passphrase --silent -o "$BUFFER_KEYPAIR"
fi
BUFFER_PUBKEY="$(solana-keygen pubkey "$BUFFER_KEYPAIR")"

echo "Cluster:       $CLUSTER"
echo "RPC:           $(masked_rpc)"
echo "Program ID:    $PROGRAM_ID"
echo "Buffer:        $BUFFER_PUBKEY"
echo "Hot wallet:    $(solana-keygen pubkey "$HOT_WALLET")"
echo "Ledger:        $(solana-keygen pubkey "$LEDGER_WALLET")"

solana program show "$PROGRAM_ID" --url "$RPC"

if solana account "$BUFFER_PUBKEY" --url "$RPC" >/dev/null 2>&1; then
  echo "Buffer account already exists: $BUFFER_PUBKEY" >&2
  exit 1
fi

verifiable_build
confirm "Upgrade $PROGRAM_ID on $CLUSTER to hash $LOCAL_HASH?" || exit 1

solana program write-buffer "$PROGRAM_SO" \
  --buffer "$BUFFER_KEYPAIR" \
  --buffer-authority "$HOT_WALLET" \
  --keypair "$HOT_WALLET" \
  --url "$RPC" \
  --use-rpc \
  --max-sign-attempts "$WRITE_BUFFER_MAX_SIGN_ATTEMPTS"

solana program set-buffer-authority "$BUFFER_PUBKEY" \
  --buffer-authority "$HOT_WALLET" \
  --new-buffer-authority "$LEDGER_PUBKEY" \
  --keypair "$HOT_WALLET" \
  --url "$RPC"

echo "Approve the upgrade on the Ledger."
solana program upgrade "$BUFFER_PUBKEY" "$PROGRAM_ID" \
  --upgrade-authority "$LEDGER_WALLET" \
  --fee-payer "$HOT_WALLET" \
  --keypair "$HOT_WALLET" \
  --url "$RPC"

ONCHAIN_HASH="$(onchain_hash)"
echo "On-chain hash: $ONCHAIN_HASH"
if [[ "$LOCAL_HASH" != "$ONCHAIN_HASH" ]]; then
  echo "Hash mismatch after upgrade." >&2
  exit 1
fi

echo "Upgrade complete. Next: commit + push, then pnpm verify -- $CLUSTER all"
