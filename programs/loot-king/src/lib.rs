use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("6hKr9jCZtjfsjtdKZ7cBvMrQsXaHjewjwsC6uW1JYXwq");

#[program]
pub mod loot_king {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, commission_wallet: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, commission_wallet)
    }

    pub fn place_bet(ctx: Context<PlaceBet>, is_fast: bool) -> Result<()> {
        instructions::place_bet::handler(ctx, is_fast)
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        instructions::claim_prize::handler(ctx)
    }

    pub fn update_commission(ctx: Context<UpdateCommission>, new_commission_bps: u64) -> Result<()> {
        instructions::update_commission::handler(ctx, new_commission_bps)
    }

    pub fn update_commission_wallet(ctx: Context<UpdateCommissionWallet>, new_commission_wallet: Pubkey) -> Result<()> {
        instructions::update_commission_wallet::handler(ctx, new_commission_wallet)
    }

    pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::transfer_authority::handler(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::accept_authority::handler(ctx)
    }

}
