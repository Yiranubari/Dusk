use anchor_lang::prelude::*;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Copy, Debug)]
pub enum MarketState {
    Open,
    Closed,
    Stale,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PythPrice {
    pub magic: u32,
    pub ver: u32,
    pub atype: u32,
    pub size: u32,
    pub conf: u64,
    pub publishing_slot: u64,
    pub valid_slot: u64,
    pub timestamp: i64,
    pub prev_timestamp: i64,
    pub price: i64,
    pub peer_price: i64,
    pub peer_conf: u64,
    pub prev_price: i64,
    pub prev_peer_price: i64,
    pub prev_peer_conf: u64,
    pub space_delimiter: u64,
}

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub state: MarketState,
    pub market_id: String,
    pub last_update_ts: i64,
    pub created_at: i64,
    pub price_feed: Pubkey,
    pub confidence_threshold: u64,
    pub max_feed_age: i64,
    pub is_paused: bool,
    pub stock_mint: Pubkey,
}

impl Market {
    pub const MAX_MARKET_ID_LEN: usize = 16;
    pub const LEN: usize = 8 + 32 + 1 + 4 + Self::MAX_MARKET_ID_LEN + 8 + 8 + 32 + 8 + 8 + 1 + 32;
}

impl Default for Market {
    fn default() -> Self {
        Self {
            authority: Pubkey::default(),
            state: MarketState::Stale,
            market_id: String::new(),
            last_update_ts: 0,
            created_at: 0,
            price_feed: Pubkey::default(),
            confidence_threshold: 0,
            max_feed_age: 3600,
            is_paused: false,
            stock_mint: Pubkey::default(),
        }
    }
}
