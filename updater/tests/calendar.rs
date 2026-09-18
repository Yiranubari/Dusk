use updater::calendar::{is_market_open, market_state};
use chrono::NaiveDate;

fn make_dt(year: i32, month: u32, day: u32, hour: u32, min: u32) -> chrono::DateTime<chrono::Utc> {
    NaiveDate::from_ymd_opt(year, month, day)
        .unwrap()
        .and_hms_opt(hour, min, 0)
        .unwrap()
        .and_utc()
}

#[test]
fn christmas_day_is_closed() {
    let christmas = make_dt(2026, 12, 25, 13, 0);
    assert_eq!(market_state(christmas), updater::MarketState::Closed);
}

#[test]
fn july_fourth_observed_2026_is_closed() {
    let jul4 = make_dt(2026, 7, 3, 10, 0);
    assert_eq!(market_state(jul4), updater::MarketState::Closed);
}

#[test]
fn july_fourth_observed_2026_early_close_is_closed() {
    let jul4_close = make_dt(2026, 7, 3, 12, 0);
    assert_eq!(market_state(jul4_close), updater::MarketState::Closed);
}

#[test]
fn christmas_eve_2026_is_closed() {
    let christmas_eve = make_dt(2026, 12, 24, 14, 0);
    assert_eq!(market_state(christmas_eve), updater::MarketState::Closed);
}

#[test]
fn christmas_eve_2025_is_closed() {
    let christmas_eve = make_dt(2025, 12, 24, 14, 0);
    assert_eq!(market_state(christmas_eve), updater::MarketState::Closed);
}

#[test]
fn normal_trading_day_open() {
    let normal = make_dt(2025, 7, 9, 14, 30);
    assert!(is_market_open(normal));
}

#[test]
fn early_close_day_before_1pm_open() {
    let early_day = make_dt(2025, 11, 28, 16, 0);
    assert!(is_market_open(early_day));
}

#[test]
fn early_close_day_at_1pm_closed() {
    let early_day = make_dt(2025, 11, 28, 13, 0);
    assert!(!is_market_open(early_day));
}