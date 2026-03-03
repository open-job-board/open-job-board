use anyhow::{Context, Result};
use reqwest::StatusCode;
use tracing::{debug, warn};

use crate::types::{JobSubmission, SubmitResponse};

/// Result of submitting a job to the Open Job Board.
#[derive(Debug)]
pub enum SubmitResult {
    Created { id: String },
    Duplicate,
    RateLimited,
    ValidationError(String),
    Error(String),
}

pub struct JobBoardClient {
    http: reqwest::Client,
    submit_url: String,
    api_key: Option<String>,
}

impl JobBoardClient {
    pub fn new(base_url: &str, api_key: Option<String>) -> Self {
        let submit_url = format!("{}/functions/v1/submit-job", base_url.trim_end_matches('/'));
        Self {
            http: reqwest::Client::new(),
            submit_url,
            api_key,
        }
    }

    pub fn from_env() -> Result<Self> {
        let base_url = std::env::var("JOB_BOARD_URL")
            .unwrap_or_else(|_| "https://ppubgurkauoptjsuyfff.supabase.co".to_string());
        let api_key = std::env::var("JOB_BOARD_API_KEY").ok();
        Ok(Self::new(&base_url, api_key))
    }

    pub async fn submit(&self, job: &JobSubmission) -> Result<SubmitResult> {
        let mut req = self
            .http
            .post(&self.submit_url)
            .header("Content-Type", "application/json");

        if let Some(key) = &self.api_key {
            req = req.header("X-API-Key", key);
        }

        let resp = req
            .json(job)
            .send()
            .await
            .context("failed to send submit request")?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| String::from("(no body)"));

        match status {
            StatusCode::CREATED => {
                let parsed: SubmitResponse =
                    serde_json::from_str(&body).unwrap_or(SubmitResponse {
                        id: None,
                        message: None,
                        details: None,
                    });
                let id = parsed.id.unwrap_or_else(|| "unknown".to_string());
                debug!(id, "job created");
                Ok(SubmitResult::Created { id })
            }
            StatusCode::CONFLICT => {
                debug!("duplicate job, skipping");
                Ok(SubmitResult::Duplicate)
            }
            StatusCode::TOO_MANY_REQUESTS => {
                warn!("rate limited");
                Ok(SubmitResult::RateLimited)
            }
            StatusCode::UNPROCESSABLE_ENTITY => {
                warn!(body, "validation error");
                Ok(SubmitResult::ValidationError(body))
            }
            _ => {
                warn!(status = %status, body, "unexpected response");
                Ok(SubmitResult::Error(format!("{status}: {body}")))
            }
        }
    }
}
