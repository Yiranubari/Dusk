use anchor_lang::prelude::*;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Copy, Debug)]
pub enum MarketState {
    Open,
    Closed,
    Stale,
}

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub state: MarketState,
    pub market_id: String,
    pub last_update_ts: i64,
    pub created_at: i64,
}

impl Market {
    pub const MAX_MARKET_ID_LEN: usize = 16;
    pub const LEN: usize = 8 + 32 + 1 + 4 + Self::MAX_MARKET_ID_LEN + 8 + 8;
}

impl Default for Market {
    fn default() -> Self {
        Self {
            authority: Pubkey::default(),
            state: MarketState::Stale,
            market_id: String::new(),
            last_update_ts: 0,
            created_at: 0,
        }
    }
}