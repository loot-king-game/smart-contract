use anchor_lang::prelude::*;
use crate::state::GameState;
use crate::constants::{GAME_STATE_SEED, MAX_COMMISSION_BPS};
use crate::errors::LootKingError;
use crate::events::CommissionUpdated;

#[derive(Accounts)]
pub struct UpdateCommission<'info> {
    #[account(
        mut,
        seeds = [GAME_STATE_SEED],
        bump = game_state.bump,
        constraint = authority.key() == game_state.authority @ LootKingError::Unauthorized
    )]
    pub game_state: Box<Account<'info, GameState>>,

    pub authority: Signer<'info>,
}

pub(crate) fn handler(ctx: Context<UpdateCommission>, new_commission_bps: u64) -> Result<()> {
    require!(
        new_commission_bps <= MAX_COMMISSION_BPS,
        LootKingError::CommissionTooHigh
    );

    let game_state = &mut ctx.accounts.game_state;
    let old_commission_bps = game_state.commission_bps;
    game_state.commission_bps = new_commission_bps;

    emit!(CommissionUpdated {
        old_commission_bps,
        new_commission_bps,
    });

    msg!(
        "Commission updated: {} bps → {} bps",
        old_commission_bps,
        new_commission_bps
    );
    Ok(())
}
