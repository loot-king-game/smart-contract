use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{GameState, WinnerRecord, BetRecord, calculate_prize_commission};
use crate::constants::*;
use crate::errors::LootKingError;
use crate::events::{BetPlaced, PendingPrizePaid, RoundEnded};

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(
        mut,
        seeds = [GAME_STATE_SEED],
        bump = game_state.bump
    )]
    pub game_state: Box<Account<'info, GameState>>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = game_state.vault_bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: Previous round winner, for auto-payout. Validated against pending_winner.
    #[account(mut)]
    pub pending_winner_account: Option<UncheckedAccount<'info>>,

    /// CHECK: Commission wallet for auto-payout. Validated against commission_wallet.
    #[account(mut)]
    pub commission_wallet_account: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

/// Calculate timer duration based on bet count and bet type
fn calculate_timer(bet_count: u32, is_fast: bool) -> i64 {
    if bet_count <= EARLY_PHASE_THRESHOLD {
        if is_fast { EARLY_FAST_TIMER } else { EARLY_TIMER }
    } else {
        if is_fast { LATE_FAST_TIMER } else { LATE_TIMER }
    }
}

pub(crate) fn handler(ctx: Context<PlaceBet>, is_fast: bool) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // --- Auto-payout pending prize if exists ---
    if game_state.has_pending_prize {
        pay_pending_prize(
            game_state,
            &ctx.accounts.vault,
            &ctx.accounts.pending_winner_account,
            &ctx.accounts.commission_wallet_account,
            &ctx.accounts.system_program.to_account_info(),
        )?;
    }

    // --- If round is active but deadline has passed, finalize it first ---
    if game_state.is_active && now >= game_state.deadline {
        finalize_round(game_state, now)?;
        // Now has_pending_prize is true, pay it
        if game_state.has_pending_prize {
            pay_pending_prize(
                game_state,
                &ctx.accounts.vault,
                &ctx.accounts.pending_winner_account,
                &ctx.accounts.commission_wallet_account,
                &ctx.accounts.system_program.to_account_info(),
            )?;
        }
    }

    // --- Determine bet amount ---
    let bet_amount = if !game_state.is_active {
        // First bet of new round — fast not allowed
        require!(!is_fast, LootKingError::FastBetNotAvailableForFirstBet);
        NORMAL_BET
    } else {
        if is_fast { FAST_BET } else { NORMAL_BET }
    };

    // --- Transfer SOL from player to vault ---
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        bet_amount,
    )?;

    // --- Start new round or update existing ---
    if !game_state.is_active {
        // New round
        game_state.round_number = game_state.round_number.checked_add(1)
            .ok_or(LootKingError::Overflow)?;
        game_state.leader = ctx.accounts.player.key();
        game_state.bank = bet_amount;
        game_state.bet_count = 1;
        game_state.round_commission_bps = game_state.commission_bps;
        game_state.deadline = now.checked_add(FIRST_BET_TIMER)
            .ok_or(LootKingError::Overflow)?;
        game_state.is_active = true;
    } else {
        // Active round — overtake leader
        require!(
            now < game_state.deadline,
            LootKingError::RoundEnded
        );
        require!(
            ctx.accounts.player.key() != game_state.leader,
            LootKingError::LeaderCannotBetAgain
        );

        game_state.leader = ctx.accounts.player.key();
        game_state.bank = game_state.bank.checked_add(bet_amount)
            .ok_or(LootKingError::Overflow)?;
        game_state.bet_count = game_state.bet_count.checked_add(1)
            .ok_or(LootKingError::Overflow)?;

        let timer = calculate_timer(game_state.bet_count, is_fast);
        game_state.deadline = now.checked_add(timer)
            .ok_or(LootKingError::Overflow)?;
    }

    emit!(BetPlaced {
        round_number: game_state.round_number,
        player: ctx.accounts.player.key(),
        bet_count: game_state.bet_count,
        deadline: game_state.deadline,
        bank: game_state.bank,
        is_fast,
    });

    let round_number = game_state.round_number;
    game_state.add_recent_bet(BetRecord {
        wallet: ctx.accounts.player.key(),
        amount: bet_amount,
        round_number,
        timestamp: now,
    });

    Ok(())
}

/// Finalize a round: calculate prize and save as pending
fn finalize_round(game_state: &mut GameState, now: i64) -> Result<()> {
    let (prize, commission) = calculate_prize_commission(game_state.bank, game_state.bet_count, game_state.round_commission_bps)?;

    let round_number = game_state.round_number;
    let winner = game_state.leader;
    let bet_count = game_state.bet_count;

    // Save to leaderboard
    let winner_record = WinnerRecord {
        wallet: winner,
        prize,
        round_number,
        timestamp: now,
    };
    game_state.add_winner(winner_record);
    game_state.add_top_winner(winner_record);

    // Mark pending
    game_state.pending_winner = winner;
    game_state.pending_prize = prize;
    game_state.pending_commission = commission;
    game_state.pending_round_number = round_number;
    game_state.pending_bet_count = bet_count;
    game_state.has_pending_prize = true;

    // Reset round
    game_state.is_active = false;
    game_state.leader = Pubkey::default();
    game_state.bank = 0;
    game_state.bet_count = 0;
    game_state.round_commission_bps = 0;
    game_state.deadline = 0;

    emit!(RoundEnded {
        round_number,
        winner,
        prize,
        commission,
        bet_count,
    });

    Ok(())
}

/// Pay out a pending prize from the vault via CPI with PDA signing
fn pay_pending_prize<'info>(
    game_state: &mut GameState,
    vault: &SystemAccount<'info>,
    pending_winner_account: &Option<UncheckedAccount<'info>>,
    commission_wallet_account: &Option<UncheckedAccount<'info>>,
    system_prog: &AccountInfo<'info>,
) -> Result<()> {
    let pending_winner_acc = pending_winner_account
        .as_ref()
        .ok_or(LootKingError::MissingPendingWinnerAccount)?;
    require_keys_eq!(
        pending_winner_acc.key(),
        game_state.pending_winner,
        LootKingError::InvalidWinner
    );

    let vault_bump = game_state.vault_bump;

    // Transfer prize to winner via CPI
    if game_state.pending_prize > 0 {
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                system_prog.clone(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: pending_winner_acc.to_account_info(),
                },
                &[vault_seeds],
            ),
            game_state.pending_prize,
        )?;
    }

    // Transfer commission
    if game_state.pending_commission > 0 {
        let commission_acc = commission_wallet_account
            .as_ref()
            .ok_or(LootKingError::MissingCommissionWalletAccount)?;
        require_keys_eq!(
            commission_acc.key(),
            game_state.commission_wallet,
            LootKingError::InvalidCommissionWallet
        );

        let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                system_prog.clone(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: commission_acc.to_account_info(),
                },
                &[vault_seeds],
            ),
            game_state.pending_commission,
        )?;
    }

    emit!(PendingPrizePaid {
        round_number: game_state.pending_round_number,
        winner: game_state.pending_winner,
        prize: game_state.pending_prize,
        commission: game_state.pending_commission,
    });

    game_state.has_pending_prize = false;
    game_state.pending_winner = Pubkey::default();
    game_state.pending_prize = 0;
    game_state.pending_commission = 0;
    game_state.pending_round_number = 0;
    game_state.pending_bet_count = 0;

    Ok(())
}
