use anchor_lang::prelude::*;
use crate::state::GameState;
use crate::constants::{GAME_STATE_SEED, VAULT_SEED, COMMISSION_BPS};
use crate::errors::LootKingError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GameState::INIT_SPACE,
        seeds = [GAME_STATE_SEED],
        bump
    )]
    pub game_state: Box<Account<'info, GameState>>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<Initialize>, commission_wallet: Pubkey) -> Result<()> {
    require!(
        commission_wallet != Pubkey::default(),
        LootKingError::InvalidCommissionWalletAddress
    );

    let game_state = &mut ctx.accounts.game_state;

    game_state.authority = ctx.accounts.authority.key();
    game_state.pending_authority = Pubkey::default();
    game_state.commission_wallet = commission_wallet;
    game_state.commission_bps = COMMISSION_BPS;
    game_state.round_number = 0;
    game_state.leader = Pubkey::default();
    game_state.bank = 0;
    game_state.bet_count = 0;
    game_state.deadline = 0;
    game_state.is_active = false;
    game_state.pending_winner = Pubkey::default();
    game_state.pending_prize = 0;
    game_state.pending_commission = 0;
    game_state.has_pending_prize = false;
    game_state.pending_round_number = 0;
    game_state.pending_bet_count = 0;
    game_state.round_commission_bps = 0;
    game_state.winners_count = 0;
    game_state.top_winners_count = 0;
    game_state.recent_bets_count = 0;
    game_state.bump = ctx.bumps.game_state;
    game_state.vault_bump = ctx.bumps.vault;

    msg!("Loot King initialized. Commission wallet: {}", commission_wallet);
    Ok(())
}
