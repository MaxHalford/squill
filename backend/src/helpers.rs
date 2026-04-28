use chrono::Utc;

/// Format the current UTC time as a SQLite-compatible datetime string.
pub fn now_sqlite() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}
