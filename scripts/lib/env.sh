# Shared config for operational scripts. Source from a script in scripts/:
#   source "$(dirname "$0")/lib/env.sh"
#   parse_cluster "$@"   # sets CLUSTER, RPC and shifts ARGS
#
# Every value can be overridden through the environment. Operator-specific
# values (authority key, signer, keypair paths) live in an untracked `.env` at
# the repo root — see `.env.example`.

set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PROGRAM_ID="${PROGRAM_ID:-6hKr9jCZtjfsjtdKZ7cBvMrQsXaHjewjwsC6uW1JYXwq}"
LIBRARY_NAME="${LIBRARY_NAME:-loot_king}"
REPO_URL="${REPO_URL:-https://github.com/loot-king-game/smart-contract}"
HOT_WALLET="${HOT_WALLET:-$HOME/.config/solana/id.json}"
# Authority signer as a Solana CLI keypair URL (e.g. usb://ledger?key=0 for a
# hardware wallet) and its public key.
SIGNER_WALLET="${SIGNER_WALLET:-}"
AUTHORITY_PUBKEY="${AUTHORITY_PUBKEY:-}"
# Program keypair, only needed for the first deploy.
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-}"
PROGRAM_SO="${PROGRAM_SO:-target/deploy/loot_king.so}"
IDL_FILE="${IDL_FILE:-idl/loot_king.json}"
# solana-verify >= 0.5.2 is required: 0.4.x cannot parse Cargo.lock files that
# use the split Solana 2.x crates (no `solana-program` entry).
SOLANA_VERIFY="${SOLANA_VERIFY:-solana-verify}"
# The deployed binary was built in Anchor's image; solana-verify's default
# image (inferred from Cargo.lock) produces a different hash.
BASE_IMAGE="${BASE_IMAGE:-solanafoundation/anchor:v0.32.1}"

usage_cluster() {
  echo "Usage: $0 devnet|mainnet ${USAGE_EXTRA:-}" >&2
  exit 1
}

# Resolves CLUSTER and RPC. Mainnet requires RPC_URL: the public mainnet-beta
# endpoint rate-limits deploys and rejects most app traffic.
parse_cluster() {
  if [[ "${1:-}" == "--" ]]; then shift; fi
  CLUSTER="${1:-}"
  shift || true
  ARGS=("$@")

  case "$CLUSTER" in
    devnet) RPC="${RPC_URL:-https://api.devnet.solana.com}" ;;
    mainnet)
      if [[ -z "${RPC_URL:-}" ]]; then
        echo "RPC_URL is required for mainnet (e.g. export RPC_URL='https://mainnet.helius-rpc.com/?api-key=...')" >&2
        exit 1
      fi
      RPC="$RPC_URL"
      ;;
    *) usage_cluster ;;
  esac
  export RPC_URL="$RPC"
}

# Prints the RPC URL with any api-key query value masked.
masked_rpc() {
  printf '%s' "$RPC" | sed -E 's/(api[-_]?key=)[^&]+/\1***/I'
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is not set (put it in .env, see .env.example)" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing file: $1" >&2
    exit 1
  fi
}

require_solana_verify() {
  local version
  version="$("$SOLANA_VERIFY" --version | awk '{print $2}')"
  if [[ "$version" =~ ^0\.([0-4]\.|5\.[01]$) ]]; then
    echo "$SOLANA_VERIFY $version is too old; install >= 0.5.2:" >&2
    echo "  cargo +1.89.0 install solana-verify --version 0.5.2 --locked" >&2
    exit 1
  fi
}

confirm() {
  if [[ "${YES:-}" == "1" ]]; then return 0; fi
  read -r -p "$1 [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

# Deterministic docker build via solana-verify. Produces $PROGRAM_SO and
# prints its hash as LOCAL_HASH.
verifiable_build() {
  require_solana_verify
  echo "Building verifiable binary with $SOLANA_VERIFY..."
  rm -f "$PROGRAM_SO"
  # Absolute mount path: solana-verify 0.5.2 mangles relative ones.
  "$SOLANA_VERIFY" build --library-name "$LIBRARY_NAME" --base-image "$BASE_IMAGE" "$SCRIPT_ROOT"
  require_file "$PROGRAM_SO"
  LOCAL_HASH="$("$SOLANA_VERIFY" get-executable-hash "$PROGRAM_SO")"
  echo "Local verifiable hash: $LOCAL_HASH"
}

onchain_hash() {
  "$SOLANA_VERIFY" get-program-hash "$PROGRAM_ID" -u "$RPC"
}
