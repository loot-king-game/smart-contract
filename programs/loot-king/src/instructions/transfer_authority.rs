use anchor_lang::prelude::*;
use crate::state::GameState;
use crate::constants::GAME_STATE_SEED;
use crate::errors::LootKingError;
use crate::events::AuthorityTransferProposed;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [GAME_STATE_SEED],
        bump = game_state.bump,
        constraint = authority.key() == game_state.authority @ LootKingError::Unauthorized
    )]
    pub game_state: Box<Account<'info, GameState>>,

    pub authority: Signer<'info>,
}

pub(crate) fn handler(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    game_state.pending_authority = new_authority;

    emit!(AuthorityTransferProposed {
        current_authority: game_state.authority,
        pending_authority: new_authority,
    });

    msg!(
        "Authority transfer proposed: {} → {}",
        game_state.authority,
        new_authority
    );
    Ok(())
}
