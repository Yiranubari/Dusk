use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Collateral amount overflow")]
    CollateralOverflow,
    #[msg("Insufficient collateral for withdrawal")]
    InsufficientCollateral,
    #[msg("Cannot withdraw while a strategy is active")]
    StrategyActive,
    #[msg("Market state is stale")]
    MarketStateStale,
    #[msg("Price feed is stale")]
    PriceFeedStale,
    #[msg("Price confidence interval is too wide")]
    PriceConfidenceTooWide,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Borrow amount exceeds LTV limit")]
    ExceedsLtvLimit,
    #[msg("Strategy already active")]
    IncompatibleStrategy,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid market state account")]
    InvalidMarketState,
    #[msg("Invalid price feed account")]
    InvalidPriceFeed,
    #[msg("Withdrawal would break collateralization limit")]
    WithdrawWouldBreakCollateralization,
    #[msg("Vault is not eligible for liquidation")]
    VaultNotUndercollateralized,
    #[msg("Vault has no collateral to liquidate")]
    NoCollateralToLiquidate,
    #[msg("Invalid expiry timestamp")]
    InvalidExpiry,
    #[msg("Option has not expired yet")]
    OptionNotExpired,
    #[msg("Vault has no active covered call option")]
    OptionNotActive,
    #[msg("Vault has no collateral")]
    NoCollateral,
    #[msg("Invalid strike price")]
    InvalidStrikePrice,
    #[msg("Option strike exceeds maximum value")]
    StrikePriceOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid stream schedule")]
    InvalidStreamSchedule,
    #[msg("Invalid stream amount")]
    InvalidStreamAmount,
    #[msg("Stream is not active")]
    StreamNotActive,
    #[msg("Stream is not revocable")]
    StreamNotRevocable,
    #[msg("Nothing currently claimable from stream")]
    NothingToClaim,
    #[msg("Protocol is paused")]
    ProtocolPaused,
}
