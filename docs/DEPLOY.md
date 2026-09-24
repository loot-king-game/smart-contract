# Operations runbook

All scripts run from the repo root. Shared defaults live in `scripts/lib/env.sh` and `scripts/lib/common.ts`; each can be overridden with an env var.

| Variable | Default |
|---|---|
| `RPC_URL` | devnet: `https://api.devnet.solana.com`; **mainnet: required** (public mainnet-beta rejects deploys and most traffic) |
| `PROGRAM_ID` | `6hKr9jCZtjfsjtdKZ7cBvMrQsXaHjewjwsC6uW1JYXwq` |
| `HOT_WALLET` | `~/.config/solana/id.json` (fee payer) |
| `LEDGER_WALLET` / `LEDGER_PATH` | `usb://ledger?key=0` / `44'/501'/0'` |
| `LEDGER_PUBKEY` | `H6b59QtgAF7VCx3j73mDqMSxhmkTR7erAL2MbsX17zfm` |
| `PROGRAM_KEYPAIR` | `.keys/loot_king-devnet-ledger-keypair.json` (first deploy only) |
| `REPO_URL` | `https://github.com/loot-king-game/smart-contract` |
| `SOLANA_VERIFY` | `solana-verify` (must be ≥ 0.5.2) |
| `BASE_IMAGE` | `solanafoundation/anchor:v0.32.1` |
| `YES=1` | skip confirmation prompts |

Never put an RPC API key or a GitHub token in a committed file or in `REPO_URL` — the repo URL is written on-chain in the verification PDA. Scripts mask `api-key=` in their output.

## Health check

```bash
RPC_URL=<rpc> pnpm status -- mainnet
```

Shows upgrade/game authority, round state and the vault reserve. Exits with code 2 on warnings (missing vault reserve, pending authority transfer, uninitialized game).

## Vault rent reserve

The vault must hold at least the rent-exempt minimum on top of the open banks, otherwise stray lamports sent to it block payouts (audit finding #7). Any wallet can fund it:

```bash
RPC_URL=<rpc> pnpm fund-vault -- mainnet            # dry run
RPC_URL=<rpc> pnpm fund-vault -- mainnet --execute  # send from HOT_WALLET
```

## First deploy (new cluster)

```bash
RPC_URL=<rpc> pnpm deploy:ledger -- mainnet          # verifiable build, deploy, IDL init, authorities → Ledger
RPC_URL=<rpc> pnpm game:setup -- mainnet             # initialize, commission wallet, vault reserve, propose Ledger
RPC_URL=<rpc> pnpm game-authority:accept -- mainnet  # Ledger accepts game authority
```

Then run the verification flow below.

## Upgrade

```bash
RPC_URL=<rpc> pnpm upgrade:ledger -- mainnet
```

Builds the verifiable binary, writes a buffer with the hot wallet (fresh buffer keypair in `.keys/`), hands the buffer to the Ledger and asks the Ledger to sign the upgrade. Afterwards:

1. `pnpm idl:build`, commit, and if the interface changed: `anchor idl upgrade --filepath idl/loot_king.json <PROGRAM_ID>` signed by the IDL authority, and copy the IDL to the frontend.
2. `pnpm idl:check -- mainnet`.
3. Commit, push, and re-run verification for the new commit.

## Verified build (OtterSec)

The repository must be public and the commit pushed.

```bash
RPC_URL=<rpc> pnpm verify -- mainnet check   # repo reachable, commit pushed, local hash == on-chain hash
RPC_URL=<rpc> pnpm verify -- mainnet pda     # export PDA tx (uploader = Ledger), sign with Ledger
RPC_URL=<rpc> pnpm verify -- mainnet remote  # submit OtterSec remote job
RPC_URL=<rpc> pnpm verify -- mainnet status  # uploaded PDA + OtterSec status
RPC_URL=<rpc> pnpm verify -- mainnet all     # check + pda + remote
```

`COMMIT=<sha>` selects another commit (default `HEAD`). The PDA records `--base-image solanafoundation/anchor:v0.32.1`; OtterSec rebuilds with the same arguments. The PDA address (`J6zm4rRiUrpHPFcEQfRgqJrA1g4kqcK24AmdbEkpq6gZ` on mainnet) depends only on program + uploader, so re-uploading updates it in place.

## Security metadata

```bash
RPC_URL=<rpc> pnpm metadata:security -- mainnet
```

Writes `security.json` (with `source_revision` = `COMMIT`/`HEAD`) to the program's `security` metadata account (`91YKdKcBc916f58ttn7SjKedLpVZ4aw25VfUVfpQDAR7` on mainnet), signed by the Ledger.

## Signing arbitrary exported transactions

```bash
TX_BASE64=<tx> RPC_URL=<rpc> pnpm ledger:send-tx -- mainnet
TX_FILE=<one base64 tx per line> RPC_URL=<rpc> pnpm ledger:send-tx -- mainnet
```

The hot wallet co-signs when it is a required signer. The blockhash is refreshed before each Ledger prompt (`REFRESH_BLOCKHASH=false` to disable).

## Known tool issues

- `anchor build --verifiable` builds the `.so` but exits non-zero on IDL extraction in 0.32.1; scripts use `solana-verify build` instead.
- `anchor deploy --verifiable` panics in 0.32.1 ("Must deploy: Os NotFound"); scripts use `solana program deploy`.
- `solana-verify` 0.5.2 breaks on a relative mount path (`Cargo.toml` → `Cargotoml`); scripts pass an absolute path.
- Docker on Apple Silicon runs the amd64 build image under emulation; the first build takes a few minutes.
