# Loot King — Solana program

On-chain "king of the hill" game. Each bet makes the bettor the leader and resets the timer; when the timer runs out, the last leader wins the bank minus commission.

| | |
|---|---|
| Program ID (devnet + mainnet) | `6hKr9jCZtjfsjtdKZ7cBvMrQsXaHjewjwsC6uW1JYXwq` |
| Framework | Anchor 0.32.1, Rust 1.89.0 |
| Upgrade / game / IDL authority | `H6b59QtgAF7VCx3j73mDqMSxhmkTR7erAL2MbsX17zfm` |
| Verified hash | `2c4dddec6ab1cedae3edb9697cd1e66667c17b99edbec324b64c8346c5f639f7` |
| Security review | [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) |

## Game rules

- Bet: 0.01 SOL, or 0.02 SOL for a "fast" bet (shorter timer). The first bet of a round must be a normal bet.
- Timer after a bet: first bet 60 min; bets 2–10 5 min (fast 2.5 min); bets 11+ 1 min (fast 30 s).
- The current leader cannot bet again until overtaken.
- Winner gets the bank minus commission (3%, capped on-chain at 10%, locked when the round starts). A solo round is refunded in full.
- Payout is permissionless: `claim_prize` can be called by anyone after the deadline, and the next round's first bet pays out automatically.

## Accounts and instructions

- `GameState` PDA (`game_state`): round state, leaderboard, recent bets, admin settings.
- `Vault` PDA (`vault`): system account holding all SOL in play, plus a small rent-exempt reserve.
- Player: `place_bet(is_fast)`, `claim_prize`.
- Authority: `initialize`, `update_commission`, `update_commission_wallet`, `transfer_authority` / `accept_authority`.

## Development

```bash
pnpm install
pnpm test              # anchor build --no-idl + bankrun test suite
pnpm idl:build         # regenerate idl/loot_king.json + idl/loot_king.ts from source
pnpm idl:check         # source IDL == committed IDL == frontend copy (add `-- mainnet` for on-chain)
pnpm typecheck         # scripts
```

`idl/loot_king.json` is the canonical IDL. It is generated with `RUSTUP_TOOLCHAIN=1.89.0` because Anchor 0.32.1's IDL builder needs `Span::local_file` (stable since Rust 1.88) and otherwise picks up an older nightly.

## Verifying the deployed program

Requirements: Docker, `solana-verify` **0.5.2 or newer** (0.4.x fails with `Failed to parse solana-program version from Cargo.lock`).

```bash
cargo +1.89.0 install solana-verify --version 0.5.2 --locked
RPC_URL=<mainnet rpc> pnpm build:verifiable -- mainnet
```

This runs `solana-verify build --base-image solanafoundation/anchor:v0.32.1 --library-name loot_king <repo>` and compares the result with the on-chain hash. The Anchor base image is required: `solana-verify`'s default image produces a different binary.

Operations (deploy, upgrade, verification, metadata) are described in [docs/DEPLOY.md](docs/DEPLOY.md).

## Security

Report vulnerabilities via [GitHub security advisories](https://github.com/loot-king-game/smart-contract/security/advisories). The same contact is published on-chain in the program's `security` metadata account.
