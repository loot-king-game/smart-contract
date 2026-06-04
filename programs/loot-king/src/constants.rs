/// Normal bet amount: 0.01 SOL
pub const NORMAL_BET: u64 = 10_000_000; // lamports

/// Fast bet amount: 0.02 SOL
pub const FAST_BET: u64 = 20_000_000; // lamports

/// Timer for the first bet in a round: 60 minutes
pub const FIRST_BET_TIMER: i64 = 3600;

/// Timer for bets 2-10 (normal): 5 minutes
pub const EARLY_TIMER: i64 = 300;

/// Timer for bets 11+ (normal): 1 minute
pub const LATE_TIMER: i64 = 60;

/// Timer for bets 2-10 (fast): 2.5 minutes
pub const EARLY_FAST_TIMER: i64 = 150;

/// Timer for bets 11+ (fast): 30 seconds
pub const LATE_FAST_TIMER: i64 = 30;

/// Commission: 3% = 300 basis points (default)
pub const COMMISSION_BPS: u64 = 300;

/// Maximum commission: 10% = 1000 basis points
pub const MAX_COMMISSION_BPS: u64 = 1000;

/// Basis points denominator
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Maximum winners in leaderboard
pub const MAX_WINNERS_HISTORY: usize = 10;

/// Maximum recent bets in circular buffer
pub const MAX_RECENT_BETS: usize = 10;

/// Threshold for switching from early to late timer phase
pub const EARLY_PHASE_THRESHOLD: u32 = 10;

/// PDA seed for game state
pub const GAME_STATE_SEED: &[u8] = b"game_state";

/// PDA seed for vault
pub const VAULT_SEED: &[u8] = b"vault";
