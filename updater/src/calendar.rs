use chrono::{Datelike, TimeZone, Timelike, Utc};
use chrono_tz::America::New_York;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarketState {
    Open,
    Closed,
    Stale,
}

const NYSE_HOLIDAYS: [(i32, u32, u32); 20] = [
    (2025, 1, 1),
    (2025, 1, 20),
    (2025, 2, 17),
    (2025, 4, 18),
    (2025, 5, 26),
    (2025, 6, 19),
    (2025, 7, 3),
    (2025, 9, 1),
    (2025, 11, 27),
    (2025, 12, 25),
    (2026, 1, 1),
    (2026, 1, 19),
    (2026, 2, 16),
    (2026, 4, 3),
    (2026, 5, 25),
    (2026, 6, 19),
    (2026, 7, 3),
    (2026, 9, 7),
    (2026, 11, 26),
    (2026, 12, 25),
];

const NYSE_EARLY_CLOSES: [(i32, u32, u32); 6] = [
    (2025, 7, 3),
    (2025, 11, 28),
    (2025, 12, 24),
    (2026, 7, 3),
    (2026, 11, 27),
    (2026, 12, 24),
];

const OPEN_TIME_HOUR: u32 = 9;
const OPEN_TIME_MINUTE: u32 = 30;
const CLOSE_TIME_HOUR: u32 = 16;
const CLOSE_TIME_MINUTE: u32 = 0;
const EARLY_CLOSE_HOUR: u32 = 13;
const EARLY_CLOSE_MINUTE: u32 = 0;

pub fn market_state(at: chrono::DateTime<Utc>) -> MarketState {
    let naive_utc = at.naive_utc();
    let dt_et = New_York.from_utc_datetime(&naive_utc);

    let year = dt_et.year();
    let month = dt_et.month();
    let day = dt_et.day();

    for &(y, m, d) in &NYSE_HOLIDAYS {
        if year == y && month == m && day == d {
            return MarketState::Closed;
        }
    }

    let is_early_close = NYSE_EARLY_CLOSES.iter().any(|&(y, m, d)| year == y && month == m && day == d);

    let hour = dt_et.hour();
    let minute = dt_et.minute();

    let weekday = dt_et.weekday();
    let is_weekend = weekday == chrono::Weekday::Sat || weekday == chrono::Weekday::Sun;
    if is_weekend {
        return MarketState::Closed;
    }

    let regular_close_hour = if is_early_close { EARLY_CLOSE_HOUR } else { CLOSE_TIME_HOUR };
    let regular_close_min = if is_early_close { EARLY_CLOSE_MINUTE } else { CLOSE_TIME_MINUTE };

    if hour < OPEN_TIME_HOUR || (hour == OPEN_TIME_HOUR && minute < OPEN_TIME_MINUTE) {
        MarketState::Closed
    } else if hour > regular_close_hour || (hour == regular_close_hour && minute >= regular_close_min) {
        MarketState::Closed
    } else {
        MarketState::Open
    }
}

pub fn is_market_open(at: chrono::DateTime<Utc>) -> bool {
    matches!(market_state(at), MarketState::Open)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn make_dt(year: i32, month: u32, day: u32, hour: u32, min: u32) -> chrono::DateTime<Utc> {
        NaiveDate::from_ymd_opt(year, month, day)
            .unwrap()
            .and_hms_opt(hour, min, 0)
            .unwrap()
            .and_utc()
    }

    #[test]
    fn holiday_is_closed() {
        let christmas = make_dt(2025, 12, 25, 10, 0);
        assert_eq!(market_state(christmas), MarketState::Closed);
    }

    #[test]
    fn early_close_morning_open() {
        let mid_morning = make_dt(2025, 11, 28, 15, 0);
        assert_eq!(market_state(mid_morning), MarketState::Open);
    }

    #[test]
    fn early_close_before_open_is_closed() {
        let before_open = make_dt(2025, 11, 28, 14, 0);
        assert_eq!(market_state(before_open), MarketState::Closed);
    }

    #[test]
    fn early_close_at_1pm_is_closed() {
        let at_close = make_dt(2025, 11, 28, 18, 0);
        assert_eq!(market_state(at_close), MarketState::Closed);
    }

    #[test]
    fn weekend_is_closed() {
        let saturday = make_dt(2025, 1, 4, 12, 0);
        assert_eq!(market_state(saturday), MarketState::Closed);
    }

    #[test]
    fn before_open_is_closed() {
        let before = make_dt(2025, 6, 16, 12, 29);
        assert_eq!(market_state(before), MarketState::Closed);
    }

    #[test]
    fn after_close_is_closed() {
        let after = make_dt(2025, 6, 16, 20, 1);
        assert_eq!(market_state(after), MarketState::Closed);
    }

    #[test]
    fn regular_hour_is_open() {
        let midday = make_dt(2025, 6, 16, 17, 0);
        assert_eq!(market_state(midday), MarketState::Open);
    }

    #[test]
    fn open_at_930_is_open() {
        let open_time = make_dt(2025, 6, 16, 13, 30);
        assert_eq!(market_state(open_time), MarketState::Open);
    }

    #[test]
    fn thanksgiving_2026_closed() {
        let tday = make_dt(2026, 11, 26, 15, 0);
        assert_eq!(market_state(tday), MarketState::Closed);
    }

    #[test]
    fn day_after_thanksgiving_2026_early_close_open_midmorning() {
        let day_after = make_dt(2026, 11, 27, 15, 0);
        assert_eq!(market_state(day_after), MarketState::Open);
    }

    #[test]
    fn day_after_thanksgiving_2026_early_close_after_1pm_closed() {
        let day_after = make_dt(2026, 11, 27, 18, 0);
        assert_eq!(market_state(day_after), MarketState::Closed);
    }
}
