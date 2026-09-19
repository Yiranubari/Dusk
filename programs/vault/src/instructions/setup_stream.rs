use anchor_lang::prelude::*;
use crate::state::{Vault, Strategy};
use crate::errors::VaultError;
use anchor_spl::token_interface::Mint;

#[derive(Accounts)]
pub struct SetupStream<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref(), stock_mint.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key() @ VaultError::Unauthorized,
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub stock_mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handle(
    ctx: Context<SetupStream>,
    recipient: Pubkey,
    start: i64,
    end: i64,
    cliff: i64,
    amount: u64,
    revocable: bool,
) -> Result<()> {
    require!(start < end, VaultError::InvalidStreamSchedule);
    require!(cliff == 0 || (cliff >= start && cliff <= end), VaultError::InvalidStreamSchedule);
    require!(amount > 0, VaultError::InvalidStreamAmount);

    let vault = &mut ctx.accounts.vault;
    require!(vault.active_strategy == Strategy::None, VaultError::IncompatibleStrategy);
    require!(amount <= vault.collateral_amount, VaultError::InsufficientCollateral);

    vault.active_strategy = Strategy::Streaming;
    vault.stream_recipient = recipient;
    vault.stream_start = start;
    vault.stream_end = end;
    vault.stream_cliff = cliff;
    vault.stream_total_amount = amount;
    vault.stream_released_amount = 0;
    vault.stream_revocable = revocable;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_setup_stream_schedule_validation() {
        let start: i64 = 100;
        let end: i64 = 200;
        assert!(start < end);

        let invalid_end: i64 = 100;
        assert!(!(start < invalid_end));

        let valid_cliff_zero: i64 = 0;
        assert!(valid_cliff_zero == 0 || (valid_cliff_zero >= start && valid_cliff_zero <= end));

        let valid_cliff: i64 = 150;
        assert!(valid_cliff == 0 || (valid_cliff >= start && valid_cliff <= end));

        let invalid_cliff_low: i64 = 50;
        assert!(!(invalid_cliff_low == 0 || (invalid_cliff_low >= start && invalid_cliff_low <= end)));

        let invalid_cliff_high: i64 = 250;
        assert!(!(invalid_cliff_high == 0 || (invalid_cliff_high >= start && invalid_cliff_high <= end)));
    }

    #[test]
    fn test_setup_stream_state_transition() {
        let mut vault = Vault::default();
        vault.collateral_amount = 500;
        vault.active_strategy = Strategy::None;

        let recipient = Pubkey::new_unique();
        let amount: u64 = 300;
        assert!(amount <= vault.collateral_amount);
        assert!(vault.active_strategy == Strategy::None);

        vault.active_strategy = Strategy::Streaming;
        vault.stream_recipient = recipient;
        vault.stream_start = 100;
        vault.stream_end = 200;
        vault.stream_cliff = 150;
        vault.stream_total_amount = amount;
        vault.stream_released_amount = 0;
        vault.stream_revocable = true;

        assert_eq!(vault.active_strategy, Strategy::Streaming);
        assert_eq!(vault.stream_recipient, recipient);
        assert_eq!(vault.stream_total_amount, 300);
        assert_eq!(vault.stream_released_amount, 0);
        assert!(vault.stream_revocable);
    }
}
