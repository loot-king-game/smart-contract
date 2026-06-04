use anchor_lang::prelude::*;
use crate::state::GameState;
use crate::constants::GAME_STATE_SEED;
use crate::errors::LootKingError;
use crate::events::CommissionWalletUpdated;

#[derive(Accounts)]
pub struct UpdateCommissionWallet<'info> {
    #[account(
        mut,
        seeds = [GAME_STATE_SEED],
        bump = game_state.bump,
        constraint = authority.key() == game_state.authority @ LootKingError::Unauthorized
    )]
    pub game_state: Box<Account<'info, GameState>>,

    pub authority: Signer<'info>,
}

pub(crate) fn handler(ctx: Context<UpdateCommissionWallet>, new_commission_wallet: Pubkey) -> Result<()> {
    require!(
        new_commission_wallet != Pubkey::default(),
        LootKingError::InvalidCommissionWalletAddress
    );

    let game_state = &mut ctx.accounts.game_state;
    let old_wallet = game_state.commission_wallet;
    game_state.commission_wallet = new_commission_wallet;

    emit!(CommissionWalletUpdated {
        old_wallet,
        new_wallet: new_commission_wallet,
    });

    msg!(
        "Commission wallet updated: {} → {}",
        old_wallet,
        new_commission_wallet
    );
    Ok(())
}
