# Loot King — Security Audit Report

> Internal reviews, not an external audit. The original report below covers the
> devnet build from 2025-02-16; the [addendum](#addendum-2026-09-23) tracks the
> resolution status on the deployed mainnet program, and the
> [2026-09-26 review](#review-2026-09-26-internal-ai-assisted) is the latest full
> review of the mainnet code.

**Date:** 2025-02-16
**Program ID:** `6Ersmor8nvBVPgy8h2pRhMNcXChj6UKDuPQcmFSb5iqr`
**Network:** Devnet
**Anchor version:** 0.32.1
**Rust version:** 1.89.0

---

## Scope

All on-chain program source code was reviewed:

| File | Description |
|------|-------------|
| `programs/loot-king/src/lib.rs` | Program entry point, instruction routing |
| `programs/loot-king/src/constants.rs` | Game constants (bets, timers, limits) |
| `programs/loot-king/src/errors.rs` | Custom error codes |
| `programs/loot-king/src/events.rs` | Event definitions |
| `programs/loot-king/src/state.rs` | GameState account, WinnerRecord, BetRecord, prize calculation |
| `programs/loot-king/src/instructions/initialize.rs` | Game initialization |
| `programs/loot-king/src/instructions/place_bet.rs` | Core betting logic + auto-payout |
| `programs/loot-king/src/instructions/claim_prize.rs` | Manual prize claim |
| `programs/loot-king/src/instructions/update_commission.rs` | Commission rate update |

**Total:** 10 files, ~470 lines of Rust

---

## Summary

The Loot King program is a "King of the Hill" style betting game on Solana. Players place bets to become the current leader; when a round's timer expires, the last bettor wins the accumulated bank minus a commission fee.

**Overall assessment: Well-written, secure program with no critical or high-severity issues found.** The code follows Anchor best practices, uses checked arithmetic throughout, and has proper access control. All findings are informational or low severity.

---

## Good Practices

### Arithmetic Safety
- All arithmetic operations use `checked_add`, `checked_mul`, `checked_sub`, `checked_div` with explicit `Overflow` error propagation
- `overflow-checks = true` enabled in `[profile.release]` (Cargo.toml workspace root)
- Bet amounts are fixed constants (0.01 / 0.02 SOL), eliminating user-controlled arithmetic input

### PDA Security
- Game state PDA derived from `"game_state"` seed with bump stored on-chain
- Vault PDA derived from `"vault"` seed with bump stored on-chain
- Both bumps are saved during `initialize` and reused via `bump = game_state.bump` — ensures canonical bumps

### Access Control
- `update_commission` gated on `authority` via Anchor `constraint = authority.key() == game_state.authority`
- `authority` must be a `Signer`, preventing spoofed authority accounts
- Commission capped at 10% (1000 basis points) via `MAX_COMMISSION_BPS`

### Account Validation
- Winner account validated via `require_keys_eq!` against `game_state.leader` in both `claim_prize` and `pay_pending_prize`
- Commission wallet validated via `require_keys_eq!` against `game_state.commission_wallet` before any transfer
- PDA accounts verified through Anchor's `seeds` + `bump` constraints

### Fund Safety
- All SOL stored in vault PDA — no tokens held in game_state account
- CPI only to `system_program` — no external program calls, eliminating cross-program reentrancy
- Solo rounds (1 bet) return full amount with zero commission — no fund extraction from single players
- No dust: bank is always multiples of 10M lamports (NORMAL_BET = 10M, FAST_BET = 20M), and commission calculation via `bank * bps / 10000` produces exact results

### State Management
- No `close_account` instruction — eliminates re-initialization attacks
- Round state fully reset after payout (leader, bank, bet_count, deadline zeroed)
- Pending prize mechanism ensures prizes are always paid (auto-payout on next bet or manual claim)
- Leader cannot bet twice consecutively (`LeaderCannotBetAgain` check)

### Events
- All state transitions emit events (`BetPlaced`, `RoundEnded`, `PendingPrizePaid`, `CommissionUpdated`)
- Events include sufficient data for off-chain indexing and auditing

---

## Findings

| # | Severity | Title | Description | Recommendation |
|---|----------|-------|-------------|----------------|
| 1 | **Informational** | No authority transfer mechanism | If the `authority` private key is lost or compromised, there is no way to transfer program admin control to a new key. The `update_commission` instruction and any future admin functions become permanently inaccessible or attacker-controlled. | Add a `transfer_authority` instruction with a two-step handoff (propose + accept) pattern. |
| 2 | **Informational** | Commission wallet is immutable | The `commission_wallet` address is set once during `initialize` and cannot be updated. If the wallet needs to change (key rotation, compromise), a full program re-initialization would be required. | Add an `update_commission_wallet` instruction gated on `authority`. |
| 3 | **Informational** | No pause mechanism | There is no way to halt the game if a bug is discovered post-deployment. New rounds can always start and bets can always be placed. | Add `pause` / `unpause` instructions gated on `authority`, with a `paused: bool` field in `GameState` checked at the start of `place_bet`. |
| 4 | **Informational** | `claim_prize` is permissionless | Anyone can call `claim_prize` to finalize a round and trigger payouts, not just the winner. This is by design (allows cranks/bots to finalize rounds), but it means the winner does not need to take any action to receive their prize. | Document this behavior. No code change needed — permissionless finalization is a valid design choice that improves UX. |
| 5 | **Low** | UncheckedAccount validation in handler vs. constraints | `pending_winner_account` and `commission_wallet_account` in `PlaceBet` are `Option<UncheckedAccount>` validated via `require_keys_eq!` in the handler body rather than Anchor `#[account(constraint = ...)]`. This works correctly but delays validation past deserialization. | Consider using `#[account(constraint = ...)]` for earlier validation where possible. Note: `Option<UncheckedAccount>` makes constraints awkward, so current approach is acceptable. |
| 6 | **Informational** | `PendingPrizePaid` event uses current round_number | In `pay_pending_prize`, the emitted `PendingPrizePaid` event uses `game_state.round_number` which is the *current* round number, not the pending round's number. If the pending prize is from round N and is paid during round N+1's bet, the event will show round N+1. | Store `pending_round_number` in `GameState` alongside other pending fields, and use it in the event. |

---

## Architecture Notes

### Fund Flow
```
Player → (system_program::transfer) → Vault PDA
Vault PDA → (CPI with PDA signer) → Winner wallet
Vault PDA → (CPI with PDA signer) → Commission wallet
```

### Round Lifecycle
```
[Inactive] → place_bet (1st bet) → [Active]
[Active] → place_bet (overtake) → [Active] (timer reset)
[Active] → deadline passes → [Finalized]
[Finalized] → claim_prize OR next place_bet → [Payout] → [Inactive]
```

### Account Structure
- **GameState PDA** (`seeds = ["game_state"]`): Single account storing all game state (~1.3 KB)
- **Vault PDA** (`seeds = ["vault"]`): System account holding all SOL in play

---

## Conclusion

The Loot King program demonstrates solid security practices for a Solana/Anchor program. The use of checked arithmetic, PDA-based fund custody, proper access control, and minimal CPI surface area result in a low-risk program. All findings are informational or low severity, relating to operational flexibility (authority transfer, pause mechanism) rather than exploitable vulnerabilities. No critical, high, or medium severity issues were found.

---

## Addendum (2026-09-23)

**Program ID:** `6hKr9jCZtjfsjtdKZ7cBvMrQsXaHjewjwsC6uW1JYXwq` (devnet + mainnet)
**Verified hash:** `2c4dddec6ab1cedae3edb9697cd1e66667c17b99edbec324b64c8346c5f639f7`

### Status of original findings

| # | Status |
|---|--------|
| 1 | Resolved — two-step `transfer_authority` / `accept_authority` |
| 2 | Resolved — `update_commission_wallet` |
| 3 | Won't fix — pause was added and later removed as unnecessary; without it the authority also cannot freeze player funds |
| 4 | Accepted by design |
| 5 | Accepted |
| 6 | Resolved — `pending_round_number` stored and emitted |

Additional changes: the commission rate is locked per round (`round_commission_bps`), so a commission update never affects a round in progress; the zero address is rejected as a commission wallet.

### New finding

| # | Severity | Title | Description | Mitigation |
|---|----------|-------|-------------|------------|
| 7 | **Low** (revised 2026-09-26, was Medium) | Stray lamports in the vault can block `claim_prize` | See [R-2](#r-2--stray-lamports-in-the-vault-block-claim_prize-low-mitigated) below: only the permissionless `claim_prize` is affected; settling through the next round's first bet still works. | Operational: vault pre-funded with a rent-exempt reserve (`pnpm fund-vault`, also done by `pnpm game:setup`); `pnpm status` warns when it is missing. |

---

## Review 2026-09-26 (internal, AI-assisted)

**Scope:** `programs/loot-king/src/**` at commit `1f618cc` — the OtterSec-verified build deployed on mainnet as `6hKr9jCZtjfsjtdKZ7cBvMrQsXaHjewjwsC6uW1JYXwq` (program source unchanged since the initial commit).
**Method:** two independent passes by AI models — Claude Opus 5.5 and Claude Fable 5.1 — reading all program code, the bankrun test suite (47 tests), targeted bankrun probes, and read-only mainnet queries/simulations. Findings were cross-checked between the passes and against the code. This is **not** a third-party professional audit.
**Mainnet state at review time:** upgrade authority, game authority and commission wallet are the same key (`H6b59QtgAF7VCx3j73mDqMSxhmkTR7erAL2MbsX17zfm`); commission 300 bps; vault reserve 1,300,480 lamports (2× the current rent-exempt minimum of 650,240).

**Result:** no path was found that lets anyone other than the upgrade authority take funds, lock them permanently, or pay the wrong recipient. Account validation, PDA handling, arithmetic and the round state machine are correct. Remaining findings are centralization, admin-caused or griefing issues with bounded impact, plus informational notes.

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| R-1 | Low (centralization) | One key holds upgrade, game authority and commission wallet | Accepted |
| R-2 | Low | Stray lamports in the vault block `claim_prize` | Mitigated (vault reserve); code fix planned |
| R-3 | Low | Commission wallet choice can block commissioned payouts | Mitigated operationally; code fix planned |
| R-4 | Low | `place_bet` has no expectation parameters | Disclosed; code fix planned |
| R-5 | Informational | `has_pending_prize` path is unreachable; payout events differ by path | Code cleanup planned |
| R-6 | Informational | bankrun test runtime differs from mainnet | Noted |
| R-7 | Informational | Late-phase timers favour faster transaction landing | Disclosed (game design) |
| R-8 | Informational | Upgrade/deployment notes | Noted |

### R-1 — One key controls everything (Low, centralization)

The upgrade authority can deploy new program code at any time, including code that moves vault funds; this power is not bounded by the program. All other admin powers are bounded (commission ≤ 10% and locked per round; commission wallet). A lost or compromised admin key would put the funds in play at risk.

**Status:** accepted. Every upgrade is public on-chain and the verified-build record lets anyone check that deployed code matches this repository. The upgradeable design is kept so bugs can be fixed.

### R-2 — Stray lamports in the vault block `claim_prize` (Low, mitigated)

`instructions/claim_prize.rs`, `instructions/place_bet.rs`. Payouts move exactly `bank` out of the vault. Without a reserve, a donation of 1…rent_min−1 lamports during a round leaves the vault rent-paying after a `claim_prize` payout, and the runtime rejects that transition (`insufficient funds for rent`). Settling the same round through the next round's first `place_bet` still succeeds, because the new bet arrives in the same transaction and keeps the vault rent-exempt; anyone can also clear the condition by topping the vault up.

**Status:** mitigated — the vault holds a rent-exempt reserve on mainnet and devnet, so donations are harmless; `pnpm status` warns if the reserve is missing; covered by the `vault rent-exempt reserve` tests. Planned: enforce the reserve in code (fund it in `initialize`, or never pay out below the rent-exempt minimum).

### R-3 — Commission wallet choice can block commissioned payouts (Low)

`instructions/update_commission_wallet.rs` only rejects the zero address, and the commission wallet is not locked per round. Two ways a commission transfer can fail, which reverts `claim_prize` and any `place_bet` that settles a multi-bet round (solo rounds still settle, as they carry no commission):

- the wallet is a reserved account (sysvar or builtin program), which the runtime demotes to read-only (`ConstraintMut`) — verified in bankrun;
- the wallet is an empty system account and the commission is below the rent-exempt minimum (e.g. 3% of a 0.02 SOL bank = 600,000 lamports < 650,240), so the transfer would create a rent-paying account.

Only the authority can set the wallet and can undo it at any time; it cannot redirect the winner's prize. Setting the wallet to a program account (e.g. the vault) would strand the commission there.

**Status:** mitigated operationally — the commission wallet is a funded wallet, and `pnpm status` warns if its balance falls below the rent-exempt minimum. Planned: validate the wallet (system-owned, not reserved), lock it per round, and/or pay the winner first with commission held back if its transfer cannot succeed.

### R-4 — `place_bet` has no expectation parameters (Low)

A bet cannot state the round, bet count or maximum commission it expects:

- a malicious authority could front-run the first bet of a new round with `update_commission` (bounded by the 10% cap);
- a normal bet intended to overtake that lands at or after the deadline settles the round (paying the previous King) and starts a new round with the sender as first bettor — no funds are lost, and a solo round is refunded in full; a fast bet in the same situation reverts instead;
- racing bets can move a bet into the next timer phase.

**Status:** disclosed on the site (FAQ, final-seconds hint; countdown synced to the on-chain clock). Planned: optional `expected_round` / `max_commission_bps` arguments.

### R-5 — Unreachable pending-prize state; event differences (Informational)

`finalize_round` and `pay_pending_prize` always run in the same transaction, so `has_pending_prize` can never persist as `true`; the branch and `pending_*` fields are unreachable. `claim_prize` does not check `has_pending_prize`, which is safe only while that state is unreachable. Payout events differ by path (`RoundEnded` + `PendingPrizePaid` vs `RoundEnded` only). Planned: remove the pending machinery (or guard `claim_prize` if it ever becomes reachable) and standardize events.

### R-6 — bankrun differs from mainnet (Informational)

The test runtime (solana-bankrun 0.4.0) uses an older rent minimum (890,880) and still enforces executable-account lamport checks that mainnet has dropped (SIMD-0162). For example, "leader converts their key into a program account" blocks payouts in bankrun but not on mainnet (verified by mainnet simulation). Runtime-dependent edge cases should be confirmed against the mainnet feature set (e.g. LiteSVM/Surfpool or simulation). Additional paths exercised and found safe: the leader settling its own expired round with itself as `pending_winner_account`, `winner == commission_wallet`, and a leader account reassigned to another owner.

### R-7 — Late-phase timers favour faster landing (Informational)

Each bet sets `deadline = now + timer` (a second bet can shorten a 60-minute round to 5 minutes). With 30–60 s windows in the late phase, priority fees and bundle services influence who lands last; a validator can only censor during its own short leader slots. A leader can re-extend with a second wallet (the leader check is per key). This matches the game design and is disclosed here.

### R-8 — Upgrade/deployment notes (Informational)

- `initialize` is permissionless: whoever calls it first becomes the authority. Moot on mainnet (authority verified), relevant for any redeploy — initialize in the same session as the deploy.
- `GameState` has no spare space (1,927 bytes = `8 + INIT_SPACE`); an upgrade that adds fields needs a realloc/migration step.
- `bank * commission_bps` could only overflow above ~1.8e16 lamports (unreachable); a `u128` intermediate is a cheap hardening.

### Checked and considered safe

PDA seeds and stored canonical bumps; vault as `SystemAccount` (cannot be substituted); winner and commission accounts checked with `require_keys_eq!` in both payout paths; duplicate writable accounts; payouts computed from `bank`, never from the vault balance (donations cannot inflate payouts, the reserve is never spent); consistent deadline boundaries (`now < deadline` to bet, `>=` to settle); leader cannot bet twice in a row; fast bet rejected as a round's first bet, including after in-transaction settlement; commission locked per round, capped, zero on solo rounds; prize + commission == bank; checked arithmetic with `overflow-checks`; all admin instructions require the authority signer; two-step authority transfer; CPI only to the System Program; bounded leaderboard buffers; no close or realloc instructions.
