use anchor_lang::prelude::*;

#[error_code]
pub enum LootKingError {
    #[msg("Round has already ended, claim the prize first")]
    RoundEnded,

    #[msg("No active round")]
    NoActiveRound,

    #[msg("Round is still active, wait for the deadline")]
    RoundStillActive,

    #[msg("Current leader cannot bet again")]
    LeaderCannotBetAgain,

    #[msg("Fast bet is not available for the first bet")]
    FastBetNotAvailableForFirstBet,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Invalid winner account")]
    InvalidWinner,

    #[msg("Invalid commission wallet account")]
    InvalidCommissionWallet,

    #[msg("Missing pending winner account")]
    MissingPendingWinnerAccount,

    #[msg("Missing commission wallet account")]
    MissingCommissionWalletAccount,

    #[msg("Commission exceeds maximum of 10%")]
    CommissionTooHigh,

    #[msg("Only the authority can perform this action")]
    Unauthorized,

    #[msg("Commission wallet cannot be the default (zero) address")]
    InvalidCommissionWalletAddress,

    #[msg("No pending authority transfer")]
    NoPendingAuthorityTransfer,

    #[msg("Signer does not match pending authority")]
    InvalidPendingAuthority,
}
