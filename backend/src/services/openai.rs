//! OpenAI service — spell caster (query rewriting) and hex remover (fix suggestions).
//!
//! Uses the OpenAI Responses API (`POST /v1/responses`) via `reqwest::Client`.
//! Both functions support an in-memory LRU-style cache (HashMap with SHA-256 keys,
//! max 5000 entries, evicts oldest on overflow).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::error;

use crate::config::Config;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SpellRequest {
    pub query: String,
    pub instruction: String,
    pub database_dialect: String,
    pub schema_context: Option<String>,
    pub selected_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellResponse {
    pub rewritten_query: String,
}

#[derive(Debug, Deserialize)]
pub struct FixRequest {
    pub query: String,
    pub error_message: String,
    pub database_dialect: String,
    pub schema_context: Option<String>,
    pub sample_queries: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixResponse {
    pub line_number: i64,
    pub original: String,
    pub suggestion: String,
    pub action: String,
    pub message: Option<String>,
    pub no_relevant_fix: bool,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct AiError {
    pub message: String,
    pub status_code: u16,
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_MAX_SIZE: usize = 5_000;

pub struct AiCache<V> {
    inner: Mutex<HashMap<String, V>>,
}

impl<V: Clone> AiCache<V> {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, key: &str) -> Option<V> {
        self.inner.lock().unwrap().get(key).cloned()
    }

    fn insert(&self, key: String, value: V) {
        let mut map = self.inner.lock().unwrap();
        if map.len() >= CACHE_MAX_SIZE {
            // Evict an arbitrary entry (HashMap iteration order)
            if let Some(oldest_key) = map.keys().next().cloned() {
                map.remove(&oldest_key);
            }
        }
        map.insert(key, value);
    }
}

fn sha256_key(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            hasher.update(b"|");
        }
        hasher.update(part.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

// ---------------------------------------------------------------------------
// OpenAI Responses API types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ResponsesApiRequest {
    model: String,
    input: Vec<Message>,
    text: TextFormat,
    temperature: f32,
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct TextFormat {
    format: FormatSpec,
}

#[derive(Serialize)]
struct FormatSpec {
    #[serde(rename = "type")]
    type_field: String,
    name: String,
    schema: serde_json::Value,
    strict: bool,
}

/// Minimal representation of the Responses API output.
#[derive(Deserialize)]
struct ResponsesApiResponse {
    output: Vec<OutputItem>,
}

#[derive(Deserialize)]
struct OutputItem {
    content: Option<Vec<ContentBlock>>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: Option<String>,
}

/// Extract the first text block from a Responses API response.
fn extract_text(resp: &ResponsesApiResponse) -> Option<&str> {
    for item in &resp.output {
        if let Some(content) = &item.content {
            for block in content {
                if let Some(text) = &block.text {
                    return Some(text);
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Spell caster
// ---------------------------------------------------------------------------

const SPELL_SYSTEM_PROMPT: &str = "\
You are an expert SQL rewriter. The user will provide a SQL query and an instruction. \
Modify the query according to the instruction. \
Preserve the overall structure and formatting of the original query. \
Return valid {dialect} SQL. \
Only return the rewritten query, no explanations. \
If a SELECTED TEXT section is provided, the instruction applies specifically to that portion of the query.";

fn build_spell_user_prompt(
    query: &str,
    instruction: &str,
    schema_context: Option<&str>,
    selected_text: Option<&str>,
) -> String {
    let mut parts = vec![
        format!("QUERY:\n{query}"),
        format!("INSTRUCTION:\n{instruction}"),
    ];
    if let Some(sel) = selected_text {
        parts.push(format!("SELECTED TEXT:\n{sel}"));
    }
    if let Some(schema) = schema_context {
        parts.push(format!("SCHEMA:\n{schema}"));
    }
    parts.join("\n\n")
}

/// Rewritten-query schema for the Responses API structured output.
fn spell_json_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "rewritten_query": { "type": "string" }
        },
        "required": ["rewritten_query"],
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
struct SpellParsed {
    rewritten_query: String,
}

pub async fn cast_spell(
    client: &reqwest::Client,
    config: &Config,
    request: &SpellRequest,
    cache: &AiCache<SpellResponse>,
) -> Result<SpellResponse, AiError> {
    // Test mode: return canned response
    if config.test_mode {
        return Ok(SpellResponse {
            rewritten_query: "SELECT * FROM test -- rewritten".to_string(),
        });
    }

    // Cache lookup
    let cache_key = sha256_key(&[
        &request.query,
        &request.instruction,
        &request.database_dialect,
    ]);
    if let Some(cached) = cache.get(&cache_key) {
        return Ok(cached);
    }

    let dialect_title = title_case(&request.database_dialect);
    let system_prompt = SPELL_SYSTEM_PROMPT.replace("{dialect}", &dialect_title);
    let user_prompt = build_spell_user_prompt(
        &request.query,
        &request.instruction,
        request.schema_context.as_deref(),
        request.selected_text.as_deref(),
    );

    let body = ResponsesApiRequest {
        model: "gpt-4o-mini".to_string(),
        input: vec![
            Message {
                role: "system".to_string(),
                content: system_prompt,
            },
            Message {
                role: "system".to_string(),
                content: format!("SQL dialect: {dialect_title}"),
            },
            Message {
                role: "user".to_string(),
                content: user_prompt,
            },
        ],
        text: TextFormat {
            format: FormatSpec {
                type_field: "json_schema".to_string(),
                name: "spell_result".to_string(),
                schema: spell_json_schema(),
                strict: true,
            },
        },
        temperature: 0.2,
    };

    let resp = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(&config.openai_api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!("OpenAI request error: {e}");
            AiError {
                message: format!("OpenAI API error: {e}"),
                status_code: 503,
            }
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        error!("OpenAI API error {status}: {text}");
        return Err(AiError {
            message: format!("OpenAI API error: {status}"),
            status_code: 503,
        });
    }

    let api_resp: ResponsesApiResponse = resp.json().await.map_err(|e| {
        error!("Failed to parse OpenAI response: {e}");
        AiError {
            message: "Failed to parse AI response".to_string(),
            status_code: 500,
        }
    })?;

    let text = extract_text(&api_resp).ok_or_else(|| AiError {
        message: "No text in AI response".to_string(),
        status_code: 500,
    })?;

    let parsed: SpellParsed = serde_json::from_str(text).map_err(|e| {
        error!("Failed to parse spell JSON: {e}");
        AiError {
            message: "Failed to parse AI response".to_string(),
            status_code: 500,
        }
    })?;

    let response = SpellResponse {
        rewritten_query: parsed.rewritten_query,
    };

    cache.insert(cache_key, response.clone());
    Ok(response)
}

// ---------------------------------------------------------------------------
// Hex remover (fix suggestion)
// ---------------------------------------------------------------------------

const FIXER_SYSTEM_PROMPT: &str = "\
You are an expert SQL fixer. The user wrote and executed a SQL query that has an issue. You are tasked with suggesting a single-line fix. \
You have two actions available: \
\"replace\" — replace an existing line with your suggestion; \
\"insert\" — insert a new line at the given position, pushing subsequent lines down. \
If you cannot determine a relevant fix (e.g., the error is about permissions, missing tables/columns that you don't have information about, or is otherwise unfixable by changing the query syntax), set no_relevant_fix to true. \
The query as a whole must make sense after applying your fix.\n\n\
Examples:\n\n\
Example 1 — replacing a line:\n\n\
QUERY:\n\
1: SELECT\n\
2:   key,\n\
3:   CUNT(*)\n\
4: FROM table\n\
5: GROUP BY key\n\n\
ERROR:\n\
Function not found: CUNT\n\n\
Response:\n\
{\"line_number\": 3, \"suggestion\": \"  COUNT(*)\", \"action\": \"replace\", \"no_relevant_fix\": false}\n\n\
Example 2 — inserting a new line:\n\n\
QUERY:\n\
1: SELECT\n\
2:   key,\n\
3:   COUNT(*)\n\
4: FROM table\n\n\
ERROR:\n\
SELECT list expression references column key which is neither grouped nor aggregated at [2:4]\n\n\
Response:\n\
{\"line_number\": 5, \"suggestion\": \"GROUP BY key\", \"action\": \"insert\", \"no_relevant_fix\": false}";

fn prepend_line_numbers(query: &str) -> String {
    query
        .lines()
        .enumerate()
        .map(|(i, line)| format!("{}: {line}", i + 1))
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_fix_user_prompt(
    query: &str,
    error_message: &str,
    schema_context: Option<&str>,
    sample_queries: Option<&str>,
) -> String {
    let mut parts = vec![
        format!("QUERY:\n{}", prepend_line_numbers(query)),
        format!("ERROR:\n{error_message}"),
    ];
    if let Some(schema) = schema_context {
        parts.push(format!("SCHEMA:\n{schema}"));
    }
    if let Some(samples) = sample_queries {
        parts.push(format!(
            "Here are some recent queries that ran successfully:\n\n{samples}"
        ));
    }
    parts.join("\n\n")
}

fn fix_json_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "line_number": { "type": "integer" },
            "suggestion": { "type": "string" },
            "action": { "type": "string" },
            "no_relevant_fix": { "type": "boolean" }
        },
        "required": ["line_number", "suggestion", "action", "no_relevant_fix"],
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
struct FixParsed {
    line_number: i64,
    suggestion: String,
    action: String,
    no_relevant_fix: bool,
}

pub async fn suggest_fix(
    client: &reqwest::Client,
    config: &Config,
    request: &FixRequest,
    cache: &AiCache<FixResponse>,
) -> Result<FixResponse, AiError> {
    // Test mode: return canned response
    if config.test_mode {
        let first_line = request.query.lines().next().unwrap_or("").to_string();
        return Ok(FixResponse {
            line_number: 1,
            original: first_line.clone(),
            suggestion: format!("{first_line} -- fixed"),
            action: "replace".to_string(),
            message: Some("Test fix".to_string()),
            no_relevant_fix: false,
        });
    }

    // Cache lookup
    let cache_key = sha256_key(&[
        &request.query,
        &request.error_message,
        &request.database_dialect,
    ]);
    if let Some(cached) = cache.get(&cache_key) {
        return Ok(cached);
    }

    let dialect_title = title_case(&request.database_dialect);
    let user_prompt = build_fix_user_prompt(
        &request.query,
        &request.error_message,
        request.schema_context.as_deref(),
        request.sample_queries.as_deref(),
    );

    let body = ResponsesApiRequest {
        model: "gpt-4.1".to_string(),
        input: vec![
            Message {
                role: "system".to_string(),
                content: FIXER_SYSTEM_PROMPT.to_string(),
            },
            Message {
                role: "system".to_string(),
                content: format!("SQL dialect: {dialect_title}"),
            },
            Message {
                role: "user".to_string(),
                content: user_prompt,
            },
        ],
        text: TextFormat {
            format: FormatSpec {
                type_field: "json_schema".to_string(),
                name: "fix_result".to_string(),
                schema: fix_json_schema(),
                strict: true,
            },
        },
        temperature: 0.2,
    };

    let resp = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(&config.openai_api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!("OpenAI request error: {e}");
            AiError {
                message: format!("OpenAI API error: {e}"),
                status_code: 503,
            }
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        error!("OpenAI API error {status}: {text}");
        return Err(AiError {
            message: format!("OpenAI API error: {status}"),
            status_code: 503,
        });
    }

    let api_resp: ResponsesApiResponse = resp.json().await.map_err(|e| {
        error!("Failed to parse OpenAI response: {e}");
        AiError {
            message: "Failed to parse AI response".to_string(),
            status_code: 500,
        }
    })?;

    let text = extract_text(&api_resp).ok_or_else(|| AiError {
        message: "No text in AI response".to_string(),
        status_code: 500,
    })?;

    let parsed: FixParsed = serde_json::from_str(text).map_err(|e| {
        error!("Failed to parse fix JSON: {e}");
        AiError {
            message: "Failed to parse AI response".to_string(),
            status_code: 500,
        }
    })?;

    let response = if parsed.no_relevant_fix {
        FixResponse {
            line_number: 0,
            original: String::new(),
            suggestion: String::new(),
            action: "replace".to_string(),
            message: Some("No relevant fix found".to_string()),
            no_relevant_fix: true,
        }
    } else {
        if parsed.line_number < 1 {
            return Err(AiError {
                message: "Invalid line number in suggestion".to_string(),
                status_code: 422,
            });
        }
        let lines: Vec<&str> = request.query.lines().collect();
        let original = if (parsed.line_number as usize) <= lines.len() {
            lines[parsed.line_number as usize - 1].to_string()
        } else {
            String::new()
        };

        FixResponse {
            line_number: parsed.line_number,
            original,
            suggestion: parsed.suggestion,
            action: parsed.action,
            message: Some(format!("Suggested fix for line {}", parsed.line_number)),
            no_relevant_fix: false,
        }
    };

    cache.insert(cache_key, response.clone());
    Ok(response)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Capitalize the first letter of a string (e.g. "bigquery" -> "Bigquery").
fn title_case(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let mut result = first.to_uppercase().to_string();
            result.extend(chars);
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_key() {
        let key = sha256_key(&["hello", "world"]);
        assert_eq!(key.len(), 64); // SHA-256 hex digest
    }

    #[test]
    fn test_title_case() {
        assert_eq!(title_case("bigquery"), "Bigquery");
        assert_eq!(title_case("postgres"), "Postgres");
        assert_eq!(title_case(""), "");
    }

    #[test]
    fn test_prepend_line_numbers() {
        let result = prepend_line_numbers("SELECT *\nFROM table");
        assert_eq!(result, "1: SELECT *\n2: FROM table");
    }

    #[test]
    fn test_cache() {
        let cache: AiCache<String> = AiCache::new();
        assert!(cache.get("missing").is_none());

        cache.insert("key1".to_string(), "value1".to_string());
        assert_eq!(cache.get("key1"), Some("value1".to_string()));
    }

    #[test]
    fn test_spell_user_prompt() {
        let prompt = build_spell_user_prompt("SELECT 1", "add column", None, None);
        assert!(prompt.contains("QUERY:\nSELECT 1"));
        assert!(prompt.contains("INSTRUCTION:\nadd column"));

        let prompt_with_schema =
            build_spell_user_prompt("SELECT 1", "add column", Some("table(id int)"), None);
        assert!(prompt_with_schema.contains("SCHEMA:\ntable(id int)"));
    }

    #[test]
    fn test_fix_user_prompt() {
        let prompt = build_fix_user_prompt("SELECT *\nFROM t", "error", None, None);
        assert!(prompt.contains("1: SELECT *"));
        assert!(prompt.contains("2: FROM t"));
        assert!(prompt.contains("ERROR:\nerror"));
    }
}
