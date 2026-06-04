use anchor_lang::prelude::*;
use crate::state::GameState;
use crate::constants::GAME_STATE_SEED;
use crate::errors::LootKingError;
use crate::events::AuthorityTransferred;

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(
        mut,
        seeds = [GAME_STATE_SEED],
        bump = game_state.bump,
    )]
    pub game_state: Box<Account<'info, GameState>>,

    pub new_authority: Signer<'info>,
}

pub(crate) fn handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;

    require!(
        game_state.pending_authority != Pubkey::default(),
        LootKingError::NoPendingAuthorityTransfer
    );
    require!(
        ctx.accounts.new_authority.key() == game_state.pending_authority,
        LootKingError::InvalidPendingAuthority
    );

    let old_authority = game_state.authority;
    game_state.authority = game_state.pending_authority;
    game_state.pending_authority = Pubkey::default();

    emit!(AuthorityTransferred {
        old_authority,
        new_authority: game_state.authority,
    });

    msg!(
        "Authority transferred: {} → {}",
        old_authority,
        game_state.authority
    );
    Ok(())
}
