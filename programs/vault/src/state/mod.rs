use anchor_lang::prelude::*;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Copy, Debug)]
#[borsh(use_discriminant = true)]
pub enum Strategy {
    None = 0,
    Borrow = 1,
    CoveredCall = 2,
    Streaming = 3,
}

impl Default for Strategy {
    fn default() -> Self {
        Strategy::None
    }
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub stock_mint: Pubkey,
    pub collateral_amount: u64,
    pub borrowed_amount: u64,
    pub active_strategy: Strategy,
    pub market_state: Pubkey,
    pub bump: u8,
}

impl Vault {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1 + 32 + 1;
}

impl Default for Vault {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            stock_mint: Pubkey::default(),
            collateral_amount: 0,
            borrowed_amount: 0,
            active_strategy: Strategy::default(),
            market_state: Pubkey::default(),
            bump: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_serialized_size_matches_len() {
        let default_vault = Vault::default();
        let serialized_len = borsh::to_vec(&default_vault).unwrap().len();
        let expected_with_discriminator = Vault::LEN;
        let actual_with_discriminator = serialized_len + 8;
        assert_eq!(
            actual_with_discriminator, expected_with_discriminator,
            "Vault struct serialized size ({} bytes + 8 discriminator) must match LEN constant ({})",
            serialized_len, expected_with_discriminator
        );
    }

    #[test]
    fn strategy_is_one_byte() {
        let strategy_size = borsh::to_vec(&Strategy::Borrow).unwrap().len();
        assert_eq!(strategy_size, 1, "Strategy enum with repr(u8) and use_discriminant should be 1 byte");
    }
}
