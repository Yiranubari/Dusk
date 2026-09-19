use anchor_lang::prelude::*;
use crate::state::{Vault, Strategy};
use crate::errors::VaultError;
use anchor_spl::token_interface::{
    self,
    Mint,
    TokenInterface,
    TokenAccount as SplTokenAccount,
};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use crate::collateral::validate_market_and_feed_staleness;

#[derive(Accounts)]
pub struct ClaimStream<'info> {
    pub recipient: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref(), stock_mint.key().as_ref()],
        bump = vault.bump,
        constraint = vault.stream_recipient == recipient.key() @ VaultError::Unauthorized,
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub stock_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = market_state.key() == vault.market_state @ VaultError::InvalidMarketState,
        constraint = market_state.stock_mint == vault.stock_mint @ VaultError::InvalidMarketState
    )]
    pub market_state: Box<Account<'info, market_state::Market>>,

    #[account(
        constraint = price_update.key() == market_state.price_feed @ VaultError::InvalidPriceFeed
    )]
    pub price_update: Box<Account<'info, PriceUpdateV2>>,

    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, SplTokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn calculate_vested_amount(
    total: u64,
    start: i64,
    end: i64,
    cliff: i64,
    now: i64,
) -> Result<u64> {
    if now < start {
        return Ok(0);
    }
    if cliff > 0 && now < cliff {
        return Ok(0);
    }
    if now >= end {
        return Ok(total);
    }
    let elapsed = (now.checked_sub(start).ok_or(VaultError::MathOverflow)?) as u128;
    let duration = (end.checked_sub(start).ok_or(VaultError::MathOverflow)?) as u128;
    let vested = (total as u128)
        .checked_mul(elapsed)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(duration)
        .ok_or(VaultError::MathOverflow)? as u64;
    Ok(vested.min(total))
}

pub fn handle(ctx: Context<ClaimStream>) -> Result<()> {
    let clock = Clock::get()?;

    validate_market_and_feed_staleness(
        &ctx.accounts.market_state,
        &ctx.accounts.price_update,
        &clock,
    )?;

    let vault = &mut ctx.accounts.vault;
    require!(vault.active_strategy == Strategy::Streaming, VaultError::StreamNotActive);

    let vested = calculate_vested_amount(
        vault.stream_total_amount,
        vault.stream_start,
        vault.stream_end,
        vault.stream_cliff,
        clock.unix_timestamp,
    )?;

    let claimable = vested
        .checked_sub(vault.stream_released_amount)
        .ok_or(VaultError::MathOverflow)?;

    require!(claimable > 0, VaultError::NothingToClaim);

    vault.collateral_amount = vault.collateral_amount
        .checked_sub(claimable)
        .ok_or(VaultError::MathOverflow)?;

    vault.stream_released_amount = vault.stream_released_amount
        .checked_add(claimable)
        .ok_or(VaultError::MathOverflow)?;

    if vault.stream_released_amount == vault.stream_total_amount {
        vault.active_strategy = Strategy::None;
        vault.stream_recipient = Pubkey::default();
        vault.stream_start = 0;
        vault.stream_end = 0;
        vault.stream_cliff = 0;
        vault.stream_total_amount = 0;
        vault.stream_released_amount = 0;
        vault.stream_revocable = false;
    }

    let cpi_accounts = token_interface::TransferChecked {
        from: ctx.accounts.vault_token_account.to_account_info(),
        mint: ctx.accounts.stock_mint.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
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

    let cpi_ctx = CpiContext::new_with_signer(
        *ctx.accounts.token_program.key,
        cpi_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, claimable, ctx.accounts.stock_mint.decimals)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_vested_amount_formula() {
        let total: u64 = 1_000_000;
        let start: i64 = 100;
        let end: i64 = 200;
        let cliff: i64 = 150;

        let v_before_start = calculate_vested_amount(total, start, end, cliff, 50).unwrap();
        assert_eq!(v_before_start, 0);

        let v_before_cliff = calculate_vested_amount(total, start, end, cliff, 149).unwrap();
        assert_eq!(v_before_cliff, 0);

        let v_at_cliff = calculate_vested_amount(total, start, end, cliff, 150).unwrap();
        assert_eq!(v_at_cliff, 500_000);

        let v_midway = calculate_vested_amount(total, start, end, cliff, 175).unwrap();
        assert_eq!(v_midway, 750_000);

        let v_at_end = calculate_vested_amount(total, start, end, cliff, 200).unwrap();
        assert_eq!(v_at_end, 1_000_000);

        let v_past_end = calculate_vested_amount(total, start, end, cliff, 250).unwrap();
        assert_eq!(v_past_end, 1_000_000);
    }

    #[test]
    fn test_sequential_claims_math() {
        let total: u64 = 1_000_000;
        let start: i64 = 100;
        let end: i64 = 200;
        let cliff: i64 = 0;

        let mut released: u64 = 0;

        let v1 = calculate_vested_amount(total, start, end, cliff, 150).unwrap();
        let claimable1 = v1 - released;
        assert_eq!(claimable1, 500_000);
        released += claimable1;

        let v2 = calculate_vested_amount(total, start, end, cliff, 175).unwrap();
        let claimable2 = v2 - released;
        assert_eq!(claimable2, 250_000);
        released += claimable2;

        let v3 = calculate_vested_amount(total, start, end, cliff, 200).unwrap();
        let claimable3 = v3 - released;
        assert_eq!(claimable3, 250_000);
        released += claimable3;

        assert_eq!(released, total);
    }
}
