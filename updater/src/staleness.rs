use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use solana_client::rpc_client::RpcClient;
use solana_pubkey::Pubkey;
use solana_sdk::commitment_config::CommitmentConfig;

pub const PYTH_RECEIVER_DISCRIMINATOR: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];

pub const LEGACY_PYTH_MAGIC: [u8; 4] = [0x20, 0x74, 0x03, 0x12];

#[derive(Debug, Clone)]
pub struct PriceFeedData {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub verification_level: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Staleness {
    Fresh,
    Stale,
}

#[derive(Debug, Clone)]
pub struct StalenessConfig {
    pub max_age_seconds: i64,
    pub max_confidence_pct: f64,
}

impl PriceFeedData {
    pub fn from_account_data(data: &[u8]) -> Option<Self> {
        if data.len() < 8 {
            return None;
        }

        if data[..8] == PYTH_RECEIVER_DISCRIMINATOR {
            return Self::from_price_update_v2(data);
        }

        if data.len() >= 4 && data[..4] == LEGACY_PYTH_MAGIC {
            return Self::from_legacy_pyth_price(data);
        }

        None
    }

    fn from_price_update_v2(data: &[u8]) -> Option<Self> {
        if data.len() < 133 {
            return None;
        }

        let mut offset = 8;
        offset += 32;

        let verification_level = data[offset];
        offset += 1;

        let feed_id: [u8; 32] = data[offset..offset + 32].try_into().ok()?;
        offset += 32;

        let price = i64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let conf = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let exponent = i32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);
        offset += 4;

        let publish_time = i64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);

        Some(Self {
            feed_id,
            price,
            conf,
            exponent,
            publish_time,
            verification_level,
        })
    }

    fn from_legacy_pyth_price(data: &[u8]) -> Option<Self> {
        if data.len() < 64 {
            return None;
        }
        let conf = u64::from_le_bytes(data[16..24].try_into().ok()?);
        let timestamp = i64::from_le_bytes(data[40..48].try_into().ok()?);
        let price = i64::from_le_bytes(data[56..64].try_into().ok()?);

        let feed_id: [u8; 32] = [0u8; 32];

        Some(Self {
            feed_id,
            price,
            conf,
            exponent: -8,
            publish_time: timestamp,
            verification_level: 1,
        })
    }

    pub fn actual_price(&self) -> f64 {
        let factor = 10f64.powi(self.exponent.unsigned_abs() as i32);
        self.price as f64 / factor
    }

    pub fn actual_conf(&self) -> f64 {
        let factor = 10f64.powi(self.exponent.unsigned_abs() as i32);
        self.conf as f64 / factor
    }

    pub fn conf_price_ratio_pct(&self) -> f64 {
        if self.price == 0 {
            return f64::INFINITY;
        }
        (self.conf as f64 / self.price as f64) * 100.0
    }
}

pub fn fetch_price_feed(rpc_url: &str, account_pubkey: &str) -> Option<PriceFeedData> {
    let pubkey = Pubkey::from_str(account_pubkey).ok()?;
    let client = RpcClient::new_with_commitment(rpc_url, CommitmentConfig::confirmed());

        let account = client.get_account(&pubkey).ok()?;
    PriceFeedData::from_account_data(account.data.as_slice())
}

pub fn check_staleness(data: &PriceFeedData, config: &StalenessConfig) -> Staleness {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let age = now - data.publish_time;
    if age > config.max_age_seconds {
        return Staleness::Stale;
    }

    let conf_pct = data.conf_price_ratio_pct();
    if conf_pct > config.max_confidence_pct {
        return Staleness::Stale;
    }

    Staleness::Fresh
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_price_update_v2_discriminator() {
        assert_eq!(
            PYTH_RECEIVER_DISCRIMINATOR,
            [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]
        );
    }

    #[test]
    fn test_legacy_magic() {
        assert_eq!(LEGACY_PYTH_MAGIC, [0x20, 0x74, 0x03, 0x12]);
    }

    #[test]
    fn test_staleness_fresh() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap();

        let data = PriceFeedData {
            feed_id: [0u8; 32],
            price: 100_000_000,
            conf: 1_000_000,
            exponent: -8,
            publish_time: now - 60,
            verification_level: 1,
        };

        let config = StalenessConfig {
            max_age_seconds: 3600,
            max_confidence_pct: 1.0,
        };

        assert_eq!(check_staleness(&data, &config), Staleness::Fresh);
    }

    #[test]
    fn test_staleness_too_old() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap();

        let data = PriceFeedData {
            feed_id: [0u8; 32],
            price: 100_000_000,
            conf: 1_000_000,
            exponent: -8,
            publish_time: now - 7200,
            verification_level: 1,
        };

        let config = StalenessConfig {
            max_age_seconds: 3600,
            max_confidence_pct: 1.0,
        };

        assert_eq!(check_staleness(&data, &config), Staleness::Stale);
    }

    #[test]
    fn test_staleness_high_confidence() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap();

        let data = PriceFeedData {
            feed_id: [0u8; 32],
            price: 100_000_000,
            conf: 10_000_000,
            exponent: -8,
            publish_time: now - 60,
            verification_level: 1,
        };

        let config = StalenessConfig {
            max_age_seconds: 3600,
            max_confidence_pct: 1.0,
        };

        assert_eq!(check_staleness(&data, &config), Staleness::Stale);
    }

    #[test]
    fn test_conf_price_ratio() {
        let data = PriceFeedData {
            feed_id: [0u8; 32],
            price: 100,
            conf: 5,
            exponent: 0,
            publish_time: 0,
            verification_level: 1,
        };
        assert!((data.conf_price_ratio_pct() - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_price_update_v2_parsing() {
        let mut data = vec![0u8; 134];
        data[..8].copy_from_slice(&PYTH_RECEIVER_DISCRIMINATOR);
        data[40] = 1;
        let feed_id: [u8; 32] = [
            0x49, 0xf6, 0xb6, 0x5c, 0xb1, 0xde, 0x6b, 0x10, 0xea, 0xf7, 0x5e, 0x7c,
            0x03, 0xca, 0x02, 0x9c, 0x30, 0x6d, 0x03, 0x57, 0xe9, 0x1b, 0x53, 0x11,
            0xb1, 0x75, 0x08, 0x4a, 0x5a, 0xd5, 0x56, 0x88,
        ];
        data[41..73].copy_from_slice(&feed_id);
        data[73..81].copy_from_slice(&30592000i64.to_le_bytes());
        data[81..89].copy_from_slice(&2000u64.to_le_bytes());
        data[89..93].copy_from_slice(&(-5i32).to_le_bytes());
        data[93..101].copy_from_slice(&1786737619i64.to_le_bytes());
        data[101..109].copy_from_slice(&1786737619i64.to_le_bytes());
        data[109..117].copy_from_slice(&30573990i64.to_le_bytes());
        data[117..125].copy_from_slice(&13975u64.to_le_bytes());
        data[125..133].copy_from_slice(&439819292u64.to_le_bytes());

        let parsed = PriceFeedData::from_account_data(&data);
        assert!(parsed.is_some());
        let parsed = parsed.unwrap();
        assert_eq!(parsed.price, 30592000);
        assert_eq!(parsed.conf, 2000);
        assert_eq!(parsed.exponent, -5);
        assert_eq!(parsed.publish_time, 1786737619);
        assert_eq!(parsed.verification_level, 1);
        assert_eq!(parsed.feed_id, feed_id);
    }
}