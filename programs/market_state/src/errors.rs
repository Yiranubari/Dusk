use anchor_lang::prelude::*;

#[error_code]
pub enum MarketStateErrorCode {
    #[msg("Market ID exceeds maximum allowed length")]
    MarketIdTooLong,
    #[msg("Caller is not authorized to update market state")]
    Unauthorized,
}