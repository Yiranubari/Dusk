use anchor_lang::prelude::*;
use crate::state::{Vault, Strategy};
use crate::errors::VaultError;
use anchor_spl::token_interface::{
    self,
    Mint,
    TokenInterface,
    TokenAccount as SplTokenAccount,
};
use anchor_spl::associated_token::AssociatedToken;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use crate::collateral::{
    validate_market_and_feed_liquidation,
    calculate_collateral_value_usd,
    calculate_collateral_from_usd,
    LIQUIDATION_INCENTIVE_BPS,
};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref(), stock_mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub stock_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = market_state.key() == vault.market_state @ VaultError::InvalidMarketState
    )]
    pub market_state: Box<Account<'info, market_state::Market>>,

    #[account(
        constraint = price_update.key() == market_state.price_feed @ VaultError::InvalidPriceFeed
    )]
    pub price_update: Box<Account<'info, PriceUpdateV2>>,

    pub stablecoin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = stablecoin_mint,
        associated_token::authority = vault,
        associated_token::token_program = stablecoin_token_program,
    )]
    pub vault_stablecoin_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    #[account(
        mut,
        associated_token::mint = stablecoin_mint,
        associated_token::authority = liquidator,
        associated_token::token_program = stablecoin_token_program,
    )]
    pub liquidator_stablecoin_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    #[account(
        init_if_needed,
        payer = liquidator,
        associated_token::mint = stock_mint,
        associated_token::authority = liquidator,
        associated_token::token_program = token_program,
    )]
    pub liquidator_token_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub stablecoin_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle(ctx: Context<Liquidate>) -> Result<()> {
    let clock = Clock::get()?;
    let threshold_bps = validate_market_and_feed_liquidation(
        &ctx.accounts.market_state,
        &ctx.accounts.price_update,
        &clock,
    )?;

    let vault = &mut ctx.accounts.vault;

    require!(vault.borrowed_amount > 0, VaultError::VaultNotUndercollateralized);
    require!(vault.collateral_amount > 0, VaultError::NoCollateralToLiquidate);

    let collateral_value_usd = calculate_collateral_value_usd(
        vault.collateral_amount,
        &ctx.accounts.stock_mint,
        &ctx.accounts.price_update,
        &clock,
        ctx.accounts.stablecoin_mint.decimals,
    )?;

    let max_liquidation_borrow = collateral_value_usd
        .checked_mul(threshold_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000u128)
        .ok_or(VaultError::MathOverflow)?;

    require!(
        (vault.borrowed_amount as u128) > max_liquidation_borrow,
        VaultError::VaultNotUndercollateralized
    );

    let debt_with_incentive_usd = (vault.borrowed_amount as u128)
        .checked_mul((10_000 + LIQUIDATION_INCENTIVE_BPS) as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000u128)
        .ok_or(VaultError::MathOverflow)?;

    let ideal_collateral_to_seize = calculate_collateral_from_usd(
        debt_with_incentive_usd,
        &ctx.accounts.stock_mint,
        &ctx.accounts.price_update,
        &clock,
        ctx.accounts.stablecoin_mint.decimals,
    )?;

    let (repay_amount, collateral_to_seize) = if ideal_collateral_to_seize <= vault.collateral_amount {
        (vault.borrowed_amount, ideal_collateral_to_seize)
    } else {
        let max_usd_covered = collateral_value_usd;
        let scaled_repay = max_usd_covered
            .checked_mul(10_000u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div((10_000 + LIQUIDATION_INCENTIVE_BPS) as u128)
            .ok_or(VaultError::MathOverflow)? as u64;
        (scaled_repay.min(vault.borrowed_amount), vault.collateral_amount)
    };

    vault.collateral_amount = vault.collateral_amount
        .checked_sub(collateral_to_seize)
        .ok_or(VaultError::MathOverflow)?;

    vault.borrowed_amount = vault.borrowed_amount
        .checked_sub(repay_amount)
        .ok_or(VaultError::MathOverflow)?;

    if vault.borrowed_amount == 0 {
        vault.active_strategy = Strategy::None;
    }

    let repay_cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.liquidator_stablecoin_account.to_account_info(),
        mint: ctx.accounts.stablecoin_mint.to_account_info(),
        to: ctx.accounts.vault_stablecoin_account.to_account_info(),
        authority: ctx.accounts.liquidator.to_account_info(),
    };
    let repay_cpi_ctx = CpiContext::new(
        *ctx.accounts.stablecoin_token_program.key,
        repay_cpi_accounts,
    );
    token_interface::transfer_checked(repay_cpi_ctx, repay_amount, ctx.accounts.stablecoin_mint.decimals)?;

    let seize_cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.vault_token_account.to_account_info(),
        mint: ctx.accounts.stock_mint.to_account_info(),
        to: ctx.accounts.liquidator_token_account.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };

    let bump = [ctx.accounts.vault.bump];
    let owner_key = ctx.accounts.vault.owner;
    let mint_key = ctx.accounts.stock_mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault",
        owner_key.as_ref(),
        mint_key.as_ref(),
        &bump,
    ]];

    let seize_cpi_ctx = CpiContext::new_with_signer(
        *ctx.accounts.token_program.key,
        seize_cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(seize_cpi_ctx, collateral_to_seize, ctx.accounts.stock_mint.decimals)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_liquidation_trigger_eligibility() {
        let collateral_value_usd: u128 = 200_000_000;
        let open_threshold: u128 = 8000;
        let max_borrow_open = collateral_value_usd * open_threshold / 10_000;
        assert_eq!(max_borrow_open, 160_000_000);

        let borrowed_amount: u128 = 150_000_000;
        assert!(borrowed_amount <= max_borrow_open);

        let closed_threshold: u128 = 5500;
        let max_borrow_closed = collateral_value_usd * closed_threshold / 10_000;
        assert_eq!(max_borrow_closed, 110_000_000);
        assert!(borrowed_amount > max_borrow_closed);
    }

    #[test]
    fn test_liquidation_normal_accounting() {
        let mut vault = Vault::default();
        vault.collateral_amount = 100_000_000;
        vault.borrowed_amount = 50_000_000;
        vault.active_strategy = Strategy::Borrow;

        let debt_with_incentive_usd = (vault.borrowed_amount as u128)
            .checked_mul((10_000 + LIQUIDATION_INCENTIVE_BPS) as u128)
            .unwrap()
            .checked_div(10_000u128)
            .unwrap();
        assert_eq!(debt_with_incentive_usd, 52_500_000);

        let ideal_collateral_to_seize = 20_000_000u64;
        assert!(ideal_collateral_to_seize <= vault.collateral_amount);

        let repay_amount = vault.borrowed_amount;
        let collateral_to_seize = ideal_collateral_to_seize;

        vault.collateral_amount = vault.collateral_amount.checked_sub(collateral_to_seize).unwrap();
        vault.borrowed_amount = vault.borrowed_amount.checked_sub(repay_amount).unwrap();

        if vault.borrowed_amount == 0 {
            vault.active_strategy = Strategy::None;
        }

        assert_eq!(vault.collateral_amount, 80_000_000);
        assert_eq!(vault.borrowed_amount, 0);
        assert_eq!(vault.active_strategy, Strategy::None);
    }

    #[test]
    fn test_liquidation_bad_debt_proportional_repayment() {
        let mut vault = Vault::default();
        vault.collateral_amount = 10_000_000;
        vault.borrowed_amount = 100_000_000;
        vault.active_strategy = Strategy::Borrow;

        let collateral_value_usd = 20_000_000u128;
        let ideal_collateral_to_seize = 50_000_000u64;

        assert!(ideal_collateral_to_seize > vault.collateral_amount);

        let max_usd_covered = collateral_value_usd;
        let scaled_repay = max_usd_covered
            .checked_mul(10_000u128)
            .unwrap()
            .checked_div((10_000 + LIQUIDATION_INCENTIVE_BPS) as u128)
            .unwrap() as u64;

        let repay_amount = scaled_repay.min(vault.borrowed_amount);
        let collateral_to_seize = vault.collateral_amount;

        vault.collateral_amount = vault.collateral_amount.checked_sub(collateral_to_seize).unwrap();
        vault.borrowed_amount = vault.borrowed_amount.checked_sub(repay_amount).unwrap();

        if vault.borrowed_amount == 0 {
            vault.active_strategy = Strategy::None;
        }

        assert_eq!(vault.collateral_amount, 0);
        assert!(vault.borrowed_amount > 0);
        assert_eq!(vault.active_strategy, Strategy::Borrow);
    }
}
