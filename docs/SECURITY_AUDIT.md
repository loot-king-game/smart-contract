# Loot King — Security Audit Report

> Internal review, not an external audit. The original report below covers the
> devnet build from 2025-02-16; see the [addendum](#addendum-2026-09-23) for
> the resolution status and findings on the deployed mainnet program.

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
| 7 | **Medium** | Vault payouts can be blocked by stray lamports | The vault PDA holds exactly the sum of open banks. Payouts transfer the full bank out. If anyone sends a few lamports to the vault during a round, the payout would leave it with a non-zero balance below the rent-exempt minimum; the runtime rejects that rent-state transition (`insufficient funds for rent`), so `claim_prize` and `place_bet` fail until the program is upgraded. | Operational: the vault is pre-funded with a rent-exempt reserve (`pnpm fund-vault`, also done by `pnpm game:setup`), after which every payout leaves at least the reserve and donations are harmless. `pnpm status` warns when the reserve is missing. Covered by the `vault rent-exempt reserve` tests. A future upgrade should fund the reserve in `initialize` or pay out `min(bank, lamports - rent_min)`. |
