use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{GameState, WinnerRecord, calculate_prize_commission};
use crate::constants::*;
use crate::errors::LootKingError;
use crate::events::RoundEnded;

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
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

    /// CHECK: The round winner. Validated against game_state.leader.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,

    /// CHECK: Commission wallet. Validated against game_state.commission_wallet.
    #[account(mut)]
    pub commission_wallet: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<ClaimPrize>) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Must have an active round
    require!(game_state.is_active, LootKingError::NoActiveRound);

    // Deadline must have passed
    require!(now >= game_state.deadline, LootKingError::RoundStillActive);

    // Validate winner account
    require_keys_eq!(
        ctx.accounts.winner.key(),
        game_state.leader,
        LootKingError::InvalidWinner
    );

    // Validate commission wallet
    require_keys_eq!(
        ctx.accounts.commission_wallet.key(),
        game_state.commission_wallet,
        LootKingError::InvalidCommissionWallet
    );

    // Calculate prize and commission
    let (prize, commission) = calculate_prize_commission(game_state.bank, game_state.bet_count, game_state.round_commission_bps)?;

    // Extract values before mutable operations
    let vault_bump = game_state.vault_bump;
    let round_number = game_state.round_number;
    let winner = game_state.leader;
    let bet_count = game_state.bet_count;

    // Transfer prize from vault to winner via CPI with PDA signing
    if prize > 0 {
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.winner.to_account_info(),
                },
                &[vault_seeds],
            ),
            prize,
        )?;
    }

    // Transfer commission from vault to commission wallet via CPI
    if commission > 0 {
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.commission_wallet.to_account_info(),
                },
                &[vault_seeds],
            ),
            commission,
        )?;
    }

    // Update leaderboard
    let winner_record = WinnerRecord {
        wallet: winner,
        prize,
        round_number,
        timestamp: now,
    };
    game_state.add_winner(winner_record);
    game_state.add_top_winner(winner_record);

    // Reset round state
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
