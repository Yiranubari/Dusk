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
use crate::collateral::{validate_market_and_feed, calculate_collateral_value_usd};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", user.key().as_ref(), stock_mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    pub stock_mint: InterfaceAccount<'info, Mint>,

    #[account(
        constraint = market_state.key() == vault.market_state @ VaultError::InvalidMarketState
    )]
    pub market_state: Account<'info, market_state::Market>,

    #[account(
        constraint = price_update.key() == market_state.price_feed @ VaultError::InvalidPriceFeed
    )]
    pub price_update: Account<'info, PriceUpdateV2>,

    pub stablecoin_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = stablecoin_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_stablecoin_account: InterfaceAccount<'info, SplTokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = stablecoin_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_stablecoin_account: InterfaceAccount<'info, SplTokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle(ctx: Context<Borrow>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let ltv_bps = validate_market_and_feed(
        &ctx.accounts.market_state,
        &ctx.accounts.price_update,
        &clock,
    )?;

    let vault = &mut ctx.accounts.vault;

    match vault.active_strategy {
        Strategy::None => {
            vault.active_strategy = Strategy::Borrow;
        }
        Strategy::Borrow => {}
        _ => {
            return err!(VaultError::IncompatibleStrategy);
        }
    }

    let collateral_value_usd = calculate_collateral_value_usd(
        vault.collateral_amount,
        &ctx.accounts.stock_mint,
        &ctx.accounts.price_update,
        &clock,
        ctx.accounts.stablecoin_mint.decimals,
    )?;

    let max_borrow = collateral_value_usd
        .checked_mul(ltv_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000u128)
        .ok_or(VaultError::MathOverflow)?;

    let new_borrowed_amount = (vault.borrowed_amount as u128)
        .checked_add(amount as u128)
        .ok_or(VaultError::MathOverflow)?;

    require!(new_borrowed_amount <= max_borrow, VaultError::ExceedsLtvLimit);

    vault.borrowed_amount = new_borrowed_amount as u64;

    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.vault_stablecoin_account.to_account_info(),
        mint: ctx.accounts.stablecoin_mint.to_account_info(),
        to: ctx.accounts.user_stablecoin_account.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };

    let bump = [ctx.accounts.vault.bump];
    let user_key = ctx.accounts.user.key();
    let mint_key = ctx.accounts.stock_mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault",
        user_key.as_ref(),
        mint_key.as_ref(),
        &bump,
    ]];

    let cpi_ctx = CpiContext::new_with_signer(
        *ctx.accounts.token_program.key,
        cpi_accounts,
        signer_seeds,
    );

    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.stablecoin_mint.decimals)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strategy_transition() {
        let mut vault = Vault::default();
        assert_eq!(vault.active_strategy, Strategy::None);

        match vault.active_strategy {
            Strategy::None => vault.active_strategy = Strategy::Borrow,
            Strategy::Borrow => {}
            _ => panic!("Should allow"),
        }
        assert_eq!(vault.active_strategy, Strategy::Borrow);

        match vault.active_strategy {
            Strategy::None => vault.active_strategy = Strategy::Borrow,
            Strategy::Borrow => {}
            _ => panic!("Should allow"),
        }
        assert_eq!(vault.active_strategy, Strategy::Borrow);

        vault.active_strategy = Strategy::CoveredCall;
        let rejected = match vault.active_strategy {
            Strategy::None | Strategy::Borrow => false,
            _ => true,
        };
        assert!(rejected);
    }
}
