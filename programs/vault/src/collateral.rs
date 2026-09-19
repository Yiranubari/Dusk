use anchor_lang::prelude::*;
use crate::errors::VaultError;
use anchor_spl::token_interface::Mint;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use anchor_spl::token_2022::spl_token_2022::{self, extension::BaseStateWithExtensions};

pub const LTV_OPEN_BPS: u64 = 6500;
pub const LTV_CLOSED_BPS: u64 = 4000;
pub const LIQUIDATION_THRESHOLD_OPEN_BPS: u64 = 8000;
pub const LIQUIDATION_THRESHOLD_CLOSED_BPS: u64 = 5500;
pub const LIQUIDATION_INCENTIVE_BPS: u64 = 500;

pub fn validate_market_and_feed(
    market: &market_state::Market,
    price_update: &PriceUpdateV2,
    clock: &Clock,
) -> Result<u64> {
    let ltv_bps = match market.state {
        market_state::MarketState::Open => LTV_OPEN_BPS,
        market_state::MarketState::Closed => LTV_CLOSED_BPS,
        market_state::MarketState::Stale => return err!(VaultError::MarketStateStale),
    };

    let price_message = &price_update.price_message;

    require!(price_message.price > 0, VaultError::InvalidPrice);

    let age = clock.unix_timestamp
        .checked_sub(price_message.publish_time)
        .ok_or(VaultError::MathOverflow)?;

    require!(age <= market.max_feed_age, VaultError::PriceFeedStale);

    let conf_scaled = (price_message.conf as u128)
        .checked_mul(10_000)
        .ok_or(VaultError::MathOverflow)?;

    let threshold_scaled = (price_message.price as u128)
        .checked_mul(market.confidence_threshold as u128)
        .ok_or(VaultError::MathOverflow)?;

    require!(conf_scaled <= threshold_scaled, VaultError::PriceConfidenceTooWide);

    Ok(ltv_bps)
}

pub fn calculate_collateral_value_usd<'info>(
    collateral_amount: u64,
    stock_mint: &InterfaceAccount<'info, Mint>,
    price_update: &Account<'info, PriceUpdateV2>,
    clock: &Clock,
    target_decimals: u8,
) -> Result<u128> {
    let price_message = &price_update.price_message;
    require!(price_message.price > 0, VaultError::InvalidPrice);

    let mint_info = stock_mint.to_account_info();
    let mint_data = mint_info.try_borrow_data()?;
    let mint_state = spl_token_2022::extension::StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
    let multiplier_f64 = if let Ok(scaled_config) = mint_state.get_extension::<spl_token_2022::extension::scaled_ui_amount::ScaledUiAmountConfig>() {
        if clock.unix_timestamp >= scaled_config.new_multiplier_effective_timestamp.into() {
            f64::from(scaled_config.new_multiplier)
        } else {
            f64::from(scaled_config.multiplier)
        }
    } else {
        1.0f64
    };

    let collateral_amount_u128 = collateral_amount as u128;
    let price_u128 = price_message.price as u128;
    let multiplier_fixed = (multiplier_f64 * 1_000_000_000.0f64) as u128;

    let stock_decimals = stock_mint.decimals as i32;
    let stable_decimals = target_decimals as i32;
    let exp = price_message.exponent;
    let net_exp = stable_decimals
        .checked_add(exp)
        .ok_or(VaultError::MathOverflow)?
        .checked_sub(stock_decimals)
        .ok_or(VaultError::MathOverflow)?
        .checked_sub(9)
        .ok_or(VaultError::MathOverflow)?;

    let raw_val = collateral_amount_u128
        .checked_mul(price_u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_mul(multiplier_fixed)
        .ok_or(VaultError::MathOverflow)?;

    let collateral_value_usd = if net_exp < 0 {
        let divisor_pow = (-net_exp) as u32;
        let divisor = 10u128.checked_pow(divisor_pow).ok_or(VaultError::MathOverflow)?;
        raw_val.checked_div(divisor).ok_or(VaultError::MathOverflow)?
    } else {
        let multiplier_pow = net_exp as u32;
        let mul = 10u128.checked_pow(multiplier_pow).ok_or(VaultError::MathOverflow)?;
        raw_val.checked_mul(mul).ok_or(VaultError::MathOverflow)?
    };

    Ok(collateral_value_usd)
}

pub fn validate_market_and_feed_liquidation(
    market: &market_state::Market,
    price_update: &PriceUpdateV2,
    clock: &Clock,
) -> Result<u64> {
    let threshold_bps = match market.state {
        market_state::MarketState::Open => LIQUIDATION_THRESHOLD_OPEN_BPS,
        market_state::MarketState::Closed => LIQUIDATION_THRESHOLD_CLOSED_BPS,
        market_state::MarketState::Stale => return err!(VaultError::MarketStateStale),
    };

    let price_message = &price_update.price_message;

    require!(price_message.price > 0, VaultError::InvalidPrice);

    let age = clock.unix_timestamp
        .checked_sub(price_message.publish_time)
        .ok_or(VaultError::MathOverflow)?;

    require!(age <= market.max_feed_age, VaultError::PriceFeedStale);

    let conf_scaled = (price_message.conf as u128)
        .checked_mul(10_000)
        .ok_or(VaultError::MathOverflow)?;

    let threshold_scaled = (price_message.price as u128)
        .checked_mul(market.confidence_threshold as u128)
        .ok_or(VaultError::MathOverflow)?;

    require!(conf_scaled <= threshold_scaled, VaultError::PriceConfidenceTooWide);

    Ok(threshold_bps)
}

pub fn calculate_collateral_from_usd<'info>(
    usd_value: u128,
    stock_mint: &InterfaceAccount<'info, Mint>,
    price_update: &Account<'info, PriceUpdateV2>,
    clock: &Clock,
    usd_decimals: u8,
) -> Result<u64> {
    let price_message = &price_update.price_message;
    require!(price_message.price > 0, VaultError::InvalidPrice);

    let mint_info = stock_mint.to_account_info();
    let mint_data = mint_info.try_borrow_data()?;
    let mint_state = spl_token_2022::extension::StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
    let multiplier_f64 = if let Ok(scaled_config) = mint_state.get_extension::<spl_token_2022::extension::scaled_ui_amount::ScaledUiAmountConfig>() {
        if clock.unix_timestamp >= scaled_config.new_multiplier_effective_timestamp.into() {
            f64::from(scaled_config.new_multiplier)
        } else {
            f64::from(scaled_config.multiplier)
        }
    } else {
        1.0f64
    };

    let price_u128 = price_message.price as u128;
    let multiplier_fixed = (multiplier_f64 * 1_000_000_000.0f64) as u128;

    let stock_decimals = stock_mint.decimals as i32;
    let stable_decimals = usd_decimals as i32;
    let exp = price_message.exponent;
    let net_exp = stable_decimals
        .checked_add(exp)
        .ok_or(VaultError::MathOverflow)?
        .checked_sub(stock_decimals)
        .ok_or(VaultError::MathOverflow)?
        .checked_sub(9)
        .ok_or(VaultError::MathOverflow)?;

    let denominator = price_u128
        .checked_mul(multiplier_fixed)
        .ok_or(VaultError::MathOverflow)?;

    let collateral_amount = if net_exp < 0 {
        let divisor_pow = (-net_exp) as u32;
        let scale = 10u128.checked_pow(divisor_pow).ok_or(VaultError::MathOverflow)?;
        usd_value
            .checked_mul(scale)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(denominator)
            .ok_or(VaultError::MathOverflow)?
    } else {
        let multiplier_pow = net_exp as u32;
        let scale = 10u128.checked_pow(multiplier_pow).ok_or(VaultError::MathOverflow)?;
        let scaled_den = denominator
            .checked_mul(scale)
            .ok_or(VaultError::MathOverflow)?;
        usd_value
            .checked_div(scaled_den)
            .ok_or(VaultError::MathOverflow)?
    };

    Ok(collateral_amount as u64)
}

pub fn validate_market_and_feed_staleness(
    market: &market_state::Market,
    price_update: &PriceUpdateV2,
    clock: &Clock,
) -> Result<()> {
    require!(market.state != market_state::MarketState::Stale, VaultError::MarketStateStale);

    let price_message = &price_update.price_message;
    require!(price_message.price > 0, VaultError::InvalidPrice);

    let age = clock.unix_timestamp
        .checked_sub(price_message.publish_time)
        .ok_or(VaultError::MathOverflow)?;

    require!(age <= market.max_feed_age, VaultError::PriceFeedStale);

    let conf_scaled = (price_message.conf as u128)
        .checked_mul(10_000)
        .ok_or(VaultError::MathOverflow)?;

    let threshold_scaled = (price_message.price as u128)
        .checked_mul(market.confidence_threshold as u128)
        .ok_or(VaultError::MathOverflow)?;

    require!(conf_scaled <= threshold_scaled, VaultError::PriceConfidenceTooWide);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ltv_constants() {
        assert_eq!(LTV_OPEN_BPS, 6500);
        assert_eq!(LTV_CLOSED_BPS, 4000);
        assert!(LTV_OPEN_BPS > LTV_CLOSED_BPS);
    }

    #[test]
    fn test_collateral_value_calculation() {
        let collateral_amount: u128 = 100_000_000;
        let price_u128: u128 = 230_000_000_00;
        let multiplier_fixed: u128 = 1_000_000_000;

        let collateral_value_usd = collateral_amount
            .checked_mul(price_u128)
            .unwrap()
            .checked_mul(multiplier_fixed)
            .unwrap()
            .checked_div(10_000_000_000_000_000_000u128)
            .unwrap();

        assert_eq!(collateral_value_usd, 230_000_000);

        let max_borrow_open = collateral_value_usd
            .checked_mul(LTV_OPEN_BPS as u128)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        assert_eq!(max_borrow_open, 149_500_000);

        let max_borrow_closed = collateral_value_usd
            .checked_mul(LTV_CLOSED_BPS as u128)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        assert_eq!(max_borrow_closed, 92_000_000);

        let collateral_amount_live: u128 = 100_000_000;
        let price_live: u128 = 30592000;
        let exp_live: i32 = -5;
        let stock_dec: i32 = 8;
        let stable_dec: i32 = 6;
        let net_exp_live = stable_dec + exp_live - stock_dec - 9;
        assert_eq!(net_exp_live, -16);
        let divisor_live = 10u128.pow((-net_exp_live) as u32);
        let val_live = collateral_amount_live
            .checked_mul(price_live)
            .unwrap()
            .checked_mul(multiplier_fixed)
            .unwrap()
            .checked_div(divisor_live)
            .unwrap();
        assert_eq!(val_live, 305_920_000);
    }
}
