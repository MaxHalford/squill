//! AI-powered SQL endpoints: spell caster (query rewriting) and hex remover (fix suggestions).

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

use crate::auth::middleware::AuthUser;
use crate::error::error_response;
use crate::services::openai::{
    self, AiCache, FixResponse as FixServiceResponse, SpellResponse as SpellServiceResponse,
};
use crate::AppState;

// ---------------------------------------------------------------------------
// Shared caches (lazily initialized via once_cell / std::sync::OnceLock)
// ---------------------------------------------------------------------------

use std::sync::OnceLock;

fn spell_cache() -> &'static AiCache<SpellServiceResponse> {
    static CACHE: OnceLock<AiCache<SpellServiceResponse>> = OnceLock::new();
    CACHE.get_or_init(AiCache::new)
}

fn fix_cache() -> &'static AiCache<FixServiceResponse> {
    static CACHE: OnceLock<AiCache<FixServiceResponse>> = OnceLock::new();
    CACHE.get_or_init(AiCache::new)
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CastSpellRequest {
    query: String,
    instruction: String,
    database_dialect: String,
    schema_context: Option<String>,
    selected_text: Option<String>,
}

#[derive(Deserialize)]
pub struct RemoveHexRequest {
    query: String,
    error_message: String,
    database_dialect: String,
    schema_context: Option<String>,
    sample_queries: Option<String>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn cast_spell(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    Json(body): Json<CastSpellRequest>,
) -> Response {
    let client = &state.http_client;
    let service_request = openai::SpellRequest {
        query: body.query,
        instruction: body.instruction,
        database_dialect: body.database_dialect,
        schema_context: body.schema_context,
        selected_text: body.selected_text,
    };

    match openai::cast_spell(&client, &state.config, &service_request, spell_cache()).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => error_response(
            StatusCode::from_u16(e.status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            &e.message,
        ),
    }
}

pub async fn remove_hex(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    Json(body): Json<RemoveHexRequest>,
) -> Response {
    let client = &state.http_client;
    let service_request = openai::FixRequest {
        query: body.query,
        error_message: body.error_message,
        database_dialect: body.database_dialect,
        schema_context: body.schema_context,
        sample_queries: body.sample_queries,
    };

    match openai::suggest_fix(&client, &state.config, &service_request, fix_cache()).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => error_response(
            StatusCode::from_u16(e.status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            &e.message,
        ),
    }
}

