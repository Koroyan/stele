//! RFC 3339 formatting (PROTOCOL_SPEC.md §7.3): `YYYY-MM-DDTHH:MM:SSZ`, UTC, second precision.

use crate::constants::MAX_RFC3339_TIMESTAMP;
use crate::encoding::push_padded;
use crate::error::CoreError;

/// Converts days since 1970-01-01 to a proleptic Gregorian (year, month, day).
///
/// Howard Hinnant's `civil_from_days`. Input range is bounded by [`MAX_RFC3339_TIMESTAMP`], so no
/// intermediate value can overflow `i64`.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Formats a Unix timestamp as RFC 3339 UTC with second precision.
pub fn format_rfc3339(t: i64) -> Result<String, CoreError> {
    if !(0..=MAX_RFC3339_TIMESTAMP).contains(&t) {
        return Err(CoreError::InvalidTimestamp);
    }
    let days = t / 86_400;
    let secs = t % 86_400;
    let (year, month, day) = civil_from_days(days);
    let mut out = String::with_capacity(20);
    push_padded(&mut out, year as u64, 4);
    out.push('-');
    push_padded(&mut out, month as u64, 2);
    out.push('-');
    push_padded(&mut out, day as u64, 2);
    out.push('T');
    push_padded(&mut out, (secs / 3_600) as u64, 2);
    out.push(':');
    push_padded(&mut out, ((secs % 3_600) / 60) as u64, 2);
    out.push(':');
    push_padded(&mut out, (secs % 60) as u64, 2);
    out.push('Z');
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_dates() {
        assert_eq!(format_rfc3339(0).unwrap(), "1970-01-01T00:00:00Z");
        assert_eq!(format_rfc3339(951_782_400).unwrap(), "2000-02-29T00:00:00Z");
        assert_eq!(
            format_rfc3339(1_700_000_000).unwrap(),
            "2023-11-14T22:13:20Z"
        );
        assert_eq!(
            format_rfc3339(4_107_542_399).unwrap(),
            "2100-02-28T23:59:59Z"
        );
        assert_eq!(
            format_rfc3339(MAX_RFC3339_TIMESTAMP).unwrap(),
            "9999-12-31T23:59:59Z"
        );
        assert_eq!(format_rfc3339(-1), Err(CoreError::InvalidTimestamp));
        assert_eq!(
            format_rfc3339(MAX_RFC3339_TIMESTAMP + 1),
            Err(CoreError::InvalidTimestamp)
        );
    }
}
