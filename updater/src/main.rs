use chrono::Utc;
use std::env;
use std::str::FromStr;
use std::time::Duration;
use solana_client::rpc_client::RpcClient;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_message::Message;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::Transaction;
use solana_sdk::commitment_config::CommitmentConfig;

use updater::calendar::is_market_open;
use updater::combinator::combine_state;
use updater::staleness::{
    check_staleness, fetch_price_feed, Staleness, StalenessConfig,
};
use updater::MarketState;


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum OnChainMarketState {
    Open = 0,
    Closed = 1,
    Stale = 2,
}

impl TryFrom<u8> for OnChainMarketState {
    type Error = &'static str;

    fn try_from(val: u8) -> Result<Self, Self::Error> {
        match val {
            0 => Ok(OnChainMarketState::Open),
            1 => Ok(OnChainMarketState::Closed),
            2 => Ok(OnChainMarketState::Stale),
            _ => Err("Invalid MarketState discriminant"),
        }
    }
}

#[derive(Debug)]
#[allow(dead_code)]
struct MarketAccount {
    authority: Pubkey,
    state: OnChainMarketState,
    market_id: String,
    last_update_ts: i64,
    created_at: i64,
    price_feed: Pubkey,
    confidence_threshold: u64,
    max_feed_age: i64,
}

impl MarketAccount {
    fn deserialize(data: &[u8]) -> Option<Self> {
        let mut offset = 0;

        if data.len() < offset + 32 { return None; }
        let authority = Pubkey::new_from_array(data[offset..offset + 32].try_into().ok()?);
        offset += 32;

        if data.len() < offset + 1 { return None; }
        let state = OnChainMarketState::try_from(data[offset]).ok()?;
        offset += 1;

        if data.len() < offset + 4 { return None; }
        let id_len = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?) as usize;
        offset += 4;
        if data.len() < offset + id_len { return None; }
        let market_id = std::str::from_utf8(&data[offset..offset + id_len]).ok()?.to_string();
        offset += id_len;

        if data.len() < offset + 8 { return None; }
        let last_update_ts = i64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        if data.len() < offset + 8 { return None; }
        let created_at = i64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        if data.len() < offset + 32 { return None; }
        let price_feed = Pubkey::new_from_array(data[offset..offset + 32].try_into().ok()?);
        offset += 32;

        if data.len() < offset + 8 { return None; }
        let confidence_threshold = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        if data.len() < offset + 8 { return None; }
        let max_feed_age = i64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);

        Some(MarketAccount {
            authority,
            state,
            market_id,
            last_update_ts,
            created_at,
            price_feed,
            confidence_threshold,
            max_feed_age,
        })
    }
}


const MARKET_STATE_PROGRAM_ID: &str =
    "DcqNBKGGXjaLXGftVsxXUrpePY9GU65UcDiPikDUtH35";

const UPDATE_MARKET_STATE_DISCRIM: [u8; 8] = {
    const RAW: Option<&str> = option_env!("IDISC_UPDATE_MARKET_STATE");
    match RAW {
        Some(s) => {
            let bytes = s.as_bytes();
            let mut result = [0u8; 8];
            let mut idx = 0;
            let mut slice_start = 0;
            let mut pos = 0;

            while pos <= bytes.len() {
                if pos == bytes.len() || bytes[pos] == b',' {
                    if idx < 8 && pos > slice_start {
                        let mut n: u8 = 0;
                        let mut j = slice_start;
                        while j < pos {
                            n = n.wrapping_mul(10).wrapping_add(bytes[j].wrapping_sub(b'0'));
                            j += 1;
                        }
                        result[idx] = n;
                        idx += 1;
                    }
                    slice_start = pos + 1;
                }
                pos += 1;
            }
            result
        }
        None => [195, 34, 135, 147, 8, 27, 159, 18],
    }
};

struct MarketConfig {
    ticker: String,
    feed_account: Pubkey,
}


fn load_authority_keypair() -> Keypair {
    let keypair_path = env::var("UPDATE_AUTHORITY_KEYPAIR").unwrap_or_else(|_| {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{}/.config/solana/id.json", home)
    });

    let expanded = shellexpand::tilde(&keypair_path).to_string();
    let data = std::fs::read_to_string(&expanded).unwrap_or_else(|e| {
        panic!(
            "Could not read authority keypair from {}: {}\n\
             Set UPDATE_AUTHORITY_KEYPAIR env var to a valid keypair file path.",
            expanded, e
        )
    });

    let secret: Vec<u8> = serde_json::from_str::<serde_json::Value>(&data)
        .expect("Authority keypair file must be JSON")
        .as_array()
        .expect("Authority keypair JSON must be an array of 64 numbers")
        .iter()
        .map(|v| v.as_u64().expect("each byte must be a u8") as u8)
        .collect();

    if secret.len() != 64 {
        panic!(
            "Authority keypair must be 64 bytes (found {})",
            secret.len()
        );
    }

        Keypair::try_from(&secret[..]).expect("Failed to parse authority keypair")
}


fn get_markets() -> Vec<MarketConfig> {
    let mut markets = Vec::new();

    if let Ok(feed_aapl) = env::var("PYTH_PRICE_FEED_ACCOUNT") {
        markets.push(MarketConfig {
            ticker: "AAPL".to_string(),
            feed_account: Pubkey::from_str(&feed_aapl)
                .expect("Invalid AAPL Pyth feed pubkey"),
        });
    }

    if let Ok(feed_tsla) = env::var("PYTH_TSLA_PRICE_FEED_ACCOUNT") {
        markets.push(MarketConfig {
            ticker: "TSLA".to_string(),
            feed_account: Pubkey::from_str(&feed_tsla)
                .expect("Invalid TSLA Pyth feed pubkey"),
        });
    }

    if markets.is_empty() {
        panic!(
            "No Pyth price feed accounts configured. Set PYTH_PRICE_FEED_ACCOUNT and \
             PYTH_TSLA_PRICE_FEED_ACCOUNT in .env"
        );
    }

    markets
}

fn derive_market_pda(market_id: &str, program_id: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[b"market", market_id.as_bytes()],
        program_id,
    );
    pda
}

fn fetch_onchain_market(
    client: &RpcClient,
    market_pda: &Pubkey,
) -> Option<MarketAccount> {
    let account = client.get_account(market_pda).ok()?;
    if account.data.len() < 8 {
        return None;
    }
    let data = &account.data[8..];
    MarketAccount::deserialize(data)
}

fn market_state_to_onchain(state: MarketState) -> OnChainMarketState {
    match state {
        MarketState::Open => OnChainMarketState::Open,
        MarketState::Closed => OnChainMarketState::Closed,
        MarketState::Stale => OnChainMarketState::Stale,
    }
}

fn onchain_to_market_state(state: OnChainMarketState) -> MarketState {
    match state {
        OnChainMarketState::Open => MarketState::Open,
        OnChainMarketState::Closed => MarketState::Closed,
        OnChainMarketState::Stale => MarketState::Stale,
    }
}


fn compute_market_state(
    market: &MarketConfig,
    rpc_url: &str,
    max_age: i64,
    max_conf: f64,
) -> MarketState {
    let now = Utc::now();
    let is_open = is_market_open(now);

    let price_data = fetch_price_feed(rpc_url, &market.feed_account.to_string());

    let staleness: Staleness = match price_data {
        Some(data) => {
            let config = StalenessConfig {
                max_age_seconds: max_age,
                max_confidence_pct: max_conf,
            };
            let result = check_staleness(&data, &config);
            println!(
                "Ticker: {} | Price: {:.4} | Conf: {:.4} | Conf%: {:.4}% | Age: {}s | Verification: {:?}",
                market.ticker,
                data.actual_price(),
                data.actual_conf(),
                data.conf_price_ratio_pct(),
                now.timestamp() - data.publish_time,
                if data.verification_level == 1 { "Full" } else { "Partial" },
            );
            result
        }
        None => {
            println!("Ticker: {} | Failed to fetch price feed data", market.ticker);
            Staleness::Stale
        }
    };

    combine_state(is_open, staleness)
}

fn build_update_instruction(
    market_pda: &Pubkey,
    authority_pubkey: &Pubkey,
    new_state: OnChainMarketState,
) -> Instruction {
    let mut data = Vec::with_capacity(9);
    data.extend_from_slice(&UPDATE_MARKET_STATE_DISCRIM);
    data.push(new_state as u8);

    let program_id =
        Pubkey::from_str(MARKET_STATE_PROGRAM_ID).expect("Invalid program ID");

        Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(*market_pda, false),
            AccountMeta::new(*authority_pubkey, true),
        ],
        data,
    }
}

fn run_once(
    client: &RpcClient,
    authority: &Keypair,
    markets: &[MarketConfig],
    max_age: i64,
    max_conf: f64,
    rpc_url: &str,
) {
    let program_id =
        Pubkey::from_str(MARKET_STATE_PROGRAM_ID).expect("Invalid program ID");

    for market in markets {
        let desired_state =
            compute_market_state(market, rpc_url, max_age, max_conf);

        let market_pda = derive_market_pda(&market.ticker, &program_id);

        let onchain_state = match fetch_onchain_market(client, &market_pda) {
            Some(acct) => {
                println!(
                    "Market {} on-chain: state {:?}, authority {}, last_update {}",
                    market.ticker,
                    acct.state,
                    acct.authority,
                    acct.last_update_ts
                );
                Some(onchain_to_market_state(acct.state))
            }
            None => {
                println!(
                    "Market {} on-chain: account not initialized",
                    market.ticker
                );
                None
            }
        };

        match onchain_state {
            Some(current) if current == desired_state => {
                println!(
                    "Market {}: state {:?} unchanged - no transaction sent",
                    market.ticker, desired_state
                );
            }
            _ => {
                let onchain_state_enum =
                    market_state_to_onchain(desired_state);
                println!(
                    "Market {}: sending update to {:?} (was {:?})",
                    market.ticker,
                    desired_state,
                    onchain_state
                );

                let instruction = build_update_instruction(
                    &market_pda,
                    &authority.pubkey(),
                    onchain_state_enum,
                );

                let recent_blockhash = client
                    .get_latest_blockhash()
                    .expect("Failed to fetch recent blockhash");

                let mut tx = Transaction::new_unsigned(Message::new(&[instruction], None));
                tx.try_sign(&[authority], recent_blockhash)
                    .expect("Failed to sign transaction");

                match client.send_and_confirm_transaction(&tx) {
                    Ok(sig) => {
                        println!(
                            "Market {}: transaction confirmed: {}",
                            market.ticker, sig
                        );
                    }
                    Err(e) => {
                        eprintln!(
                            "Market {}: failed to send transaction: {}",
                            market.ticker, e
                        );
                    }
                }
            }
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();

        let mut rpc_url = env::var("LOCAL_RPC_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8899".to_string());
    let mut interval_secs: u64 = env::var("UPDATE_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(60);
    let mut max_age: i64 = 3600;
    let mut max_conf: f64 = 1.0;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--rpc" => {
                i += 1;
                rpc_url = args.get(i).expect("--rpc requires a value").clone();
            }
            "--interval" => {
                i += 1;
                interval_secs = args
                    .get(i)
                    .and_then(|s| s.parse::<u64>().ok())
                    .expect("--interval requires an integer");
            }
            "--max-age" => {
                i += 1;
                max_age = args
                    .get(i)
                    .and_then(|s| s.parse::<i64>().ok())
                    .expect("--max-age requires an integer");
            }
            "--max-conf" => {
                i += 1;
                max_conf = args
                    .get(i)
                    .and_then(|s| s.parse::<f64>().ok())
                    .expect("--max-conf requires a number");
            }
            _ => {}
        }
        i += 1;
    }

    println!("Dusk market-state updater");
    println!("   RPC:       {}", rpc_url);
    println!("   Interval:  {}s", interval_secs);
    println!("   Max age:   {}s", max_age);
    println!("   Max conf:  {:.2}%", max_conf * 100.0);

    let authority = load_authority_keypair();
    println!("   Authority: {}", authority.pubkey());

    let markets = get_markets();
    println!(
        "   Markets:   {}",
        markets.iter().map(|m| m.ticker.as_str()).collect::<Vec<_>>().join(", ")
    );

    let client = RpcClient::new_with_commitment(&rpc_url, CommitmentConfig::confirmed());

    println!("--- Starting continuous updater loop ---");

    loop {
                run_once(&client, &authority, &markets, max_age, max_conf, &rpc_url);
        println!("--- sleeping {} seconds ---", interval_secs);
        std::thread::sleep(Duration::from_secs(interval_secs));
    }
}
