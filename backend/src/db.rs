use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

/// Create and return a SQLite connection pool, running migrations on startup.
pub async fn create_pool(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // Run embedded migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}

/// Idempotently create a local VIP user for desktop/MCP usage.
///
/// This ensures the MCP tools can operate without OAuth by guaranteeing the
/// user row referenced by `mcp_user_id` exists.
pub async fn ensure_mcp_local_user(pool: &SqlitePool, user_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, email, first_name, last_name, plan, is_vip, created_at, last_login_at)
         VALUES (?, 'local@squill.desktop', 'Local', 'User', 'pro', 1, datetime('now'), datetime('now'))",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}
