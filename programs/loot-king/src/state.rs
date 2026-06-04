use anchor_lang::prelude::*;
use crate::constants::{MAX_WINNERS_HISTORY, MAX_RECENT_BETS, BPS_DENOMINATOR};
use crate::errors::LootKingError;

#[account]
#[derive(InitSpace)]
pub struct GameState {
    // --- Admin ---
    /// Program authority (deployer)
    pub authority: Pubkey,
    /// Proposed new authority (for two-step transfer)
    pub pending_authority: Pubkey,
    /// Wallet that receives commission
    pub commission_wallet: Pubkey,
    /// Commission in basis points (max 1000 = 10%)
    pub commission_bps: u64,

    // --- Current round ---
    /// Current round number (starts at 1)
    pub round_number: u64,
    /// Current leader's pubkey
    pub leader: Pubkey,
    /// Total bank for current round (in lamports)
    pub bank: u64,
    /// Number of bets in current round
    pub bet_count: u32,
    /// Commission rate locked at round start (basis points)
    pub round_commission_bps: u64,
    /// Deadline timestamp (unix seconds)
    pub deadline: i64,
    /// Whether a round is currently active
    pub is_active: bool,

    // --- Pending prize (for auto-payout) ---
    /// Winner of the previous unclaimed round
    pub pending_winner: Pubkey,
    /// Prize amount for the pending winner
    pub pending_prize: u64,
    /// Commission amount for the pending round
    pub pending_commission: u64,
    /// Whether there is an unclaimed prize
    pub has_pending_prize: bool,

    // --- Leaderboard ---
    /// Last N winners (circular buffer)
    pub winners: [WinnerRecord; MAX_WINNERS_HISTORY],
    /// How many winner records have been filled (max 10)
    pub winners_count: u8,

    // --- Top Winners (sorted by prize desc) ---
    pub top_winners: [WinnerRecord; MAX_WINNERS_HISTORY],
    pub top_winners_count: u8,

    // --- Recent Bets (circular buffer) ---
    pub recent_bets: [BetRecord; MAX_RECENT_BETS],
    pub recent_bets_count: u8,

    // --- Pending round tracking ---
    /// Round number for the pending prize (for correct event emission)
    pub pending_round_number: u64,
    /// Number of bets in the pending round (for correct prize calculation context)
    pub pending_bet_count: u32,

    // --- PDA bump ---
    pub bump: u8,
    pub vault_bump: u8,
}

impl GameState {
    /// Add a winner to the leaderboard (circular buffer, newest last)
    pub fn add_winner(&mut self, record: WinnerRecord) {
        if (self.winners_count as usize) < MAX_WINNERS_HISTORY {
            self.winners[self.winners_count as usize] = record;
            self.winners_count += 1;
        } else {
            // Shift left (drop oldest) and add new at the end
            for i in 0..MAX_WINNERS_HISTORY - 1 {
                self.winners[i] = self.winners[i + 1];
            }
            self.winners[MAX_WINNERS_HISTORY - 1] = record;
        }
    }

    /// Add to top winners, sorted by prize descending. Drop the smallest if full.
    pub fn add_top_winner(&mut self, record: WinnerRecord) {
        let count = self.top_winners_count as usize;

        if count < MAX_WINNERS_HISTORY {
            // Not full yet — insert in sorted position
            let mut pos = count;
            for i in 0..count {
                if record.prize > self.top_winners[i].prize {
                    pos = i;
                    break;
                }
            }
            // Shift right from pos
            let mut j = count;
            while j > pos {
                self.top_winners[j] = self.top_winners[j - 1];
                j -= 1;
            }
            self.top_winners[pos] = record;
            self.top_winners_count += 1;
        } else {
            // Full — check if new record beats the smallest (last entry)
            let last = MAX_WINNERS_HISTORY - 1;
            if record.prize > self.top_winners[last].prize {
                // Find insertion position
                let mut pos = last;
                for i in 0..MAX_WINNERS_HISTORY {
                    if record.prize > self.top_winners[i].prize {
                        pos = i;
                        break;
                    }
                }
                // Shift right from pos, dropping last
                let mut j = last;
                while j > pos {
                    self.top_winners[j] = self.top_winners[j - 1];
                    j -= 1;
                }
                self.top_winners[pos] = record;
            }
        }
    }

    /// Add a recent bet to the circular buffer
    pub fn add_recent_bet(&mut self, record: BetRecord) {
        if (self.recent_bets_count as usize) < MAX_RECENT_BETS {
            self.recent_bets[self.recent_bets_count as usize] = record;
            self.recent_bets_count += 1;
        } else {
            // Shift left (drop oldest) and add new at the end
            for i in 0..MAX_RECENT_BETS - 1 {
                self.recent_bets[i] = self.recent_bets[i + 1];
            }
            self.recent_bets[MAX_RECENT_BETS - 1] = record;
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct WinnerRecord {
    /// Winner wallet address
    pub wallet: Pubkey,
    /// Prize amount (in lamports)
    pub prize: u64,
    /// Round number
    pub round_number: u64,
    /// Timestamp when round ended
    pub timestamp: i64,
}

impl WinnerRecord {
    pub const SPACE: usize = 32 + 8 + 8 + 8; // 56 bytes
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct BetRecord {
    /// Bettor wallet address
    pub wallet: Pubkey,
    /// Bet amount (in lamports)
    pub amount: u64,
    /// Round number
    pub round_number: u64,
    /// Timestamp when bet was placed
    pub timestamp: i64,
}

impl BetRecord {
    pub const SPACE: usize = 32 + 8 + 8 + 8; // 56 bytes
}

/// Calculate prize and commission from bank, bet count, and commission rate.
/// Solo rounds (bet_count == 1) get full refund with no commission.
pub fn calculate_prize_commission(bank: u64, bet_count: u32, commission_bps: u64) -> Result<(u64, u64)> {
    if bet_count == 1 {
        Ok((bank, 0u64))
    } else {
        let commission = bank
            .checked_mul(commission_bps)
            .ok_or(LootKingError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(LootKingError::Overflow)?;
        let prize = bank
            .checked_sub(commission)
            .ok_or(LootKingError::Overflow)?;
        Ok((prize, commission))
    }
}
