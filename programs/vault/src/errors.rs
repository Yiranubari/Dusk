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
}
