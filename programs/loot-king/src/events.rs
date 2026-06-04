use anchor_lang::prelude::*;

#[event]
pub struct BetPlaced {
    pub round_number: u64,
    pub player: Pubkey,
    pub bet_count: u32,
    pub deadline: i64,
    pub bank: u64,
    pub is_fast: bool,
}

#[event]
pub struct RoundEnded {
    pub round_number: u64,
    pub winner: Pubkey,
    pub prize: u64,
    pub commission: u64,
    pub bet_count: u32,
}

#[event]
pub struct PendingPrizePaid {
    pub round_number: u64,
    pub winner: Pubkey,
    pub prize: u64,
    pub commission: u64,
}

#[event]
pub struct CommissionUpdated {
    pub old_commission_bps: u64,
    pub new_commission_bps: u64,
}

#[event]
pub struct AuthorityTransferProposed {
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
}

#[event]
pub struct AuthorityTransferred {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct CommissionWalletUpdated {
    pub old_wallet: Pubkey,
    pub new_wallet: Pubkey,
}
