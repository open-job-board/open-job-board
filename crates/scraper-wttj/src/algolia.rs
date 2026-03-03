use anyhow::{Context, Result};
use serde::Deserialize;
use tracing::debug;

const ALGOLIA_APP_ID: &str = "CSEKHVMS53";
const ALGOLIA_API_KEY: &str = "4bd8f6215d0cc52b26430765769e65a0";
const ALGOLIA_INDEX: &str = "wttj_jobs_production_en";
const ALGOLIA_URL: &str = "https://CSEKHVMS53-dsn.algolia.net/1/indexes/*/queries";

/// A single job hit from the Algolia response.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AlgoliaJob {
    #[serde(rename = "objectID")]
    pub object_id: String,
    pub name: String,
    pub summary: Option<String>,
    pub slug: Option<String>,
    pub contract_type: Option<String>,
    pub remote: Option<String>,
    pub salary_minimum: Option<f64>,
    pub salary_maximum: Option<f64>,
    pub salary_currency: Option<String>,
    pub salary_period: Option<String>,
    pub published_at: Option<String>,
    pub benefits: Option<Vec<String>>,
    pub key_missions: Option<Vec<String>>,
    pub offices: Option<Vec<Office>>,
    pub organization: Option<Organization>,
    pub sectors: Option<Vec<Sector>>,
    pub new_profession: Option<Profession>,
    pub experience_level_minimum: Option<f64>,
    pub language: Option<String>,
    pub wk_reference: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Office {
    pub city: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Organization {
    pub name: Option<String>,
    pub description: Option<String>,
    pub summary: Option<String>,
    pub slug: Option<String>,
    pub reference: Option<String>,
    pub nb_employees: Option<u64>,
    pub creation_year: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct Sector {
    pub name: Option<String>,
    pub parent_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Profession {
    pub pivot_name: Option<String>,
    pub category_name: Option<String>,
    pub sub_category_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AlgoliaResponse {
    results: Vec<AlgoliaResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlgoliaResult {
    hits: Vec<AlgoliaJob>,
    nb_pages: u32,
    page: u32,
    nb_hits: u64,
}

pub struct AlgoliaClient {
    http: reqwest::Client,
}

impl AlgoliaClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }

    /// Fetch a page of jobs from Algolia. Returns (jobs, total_pages).
    pub async fn fetch_page(&self, page: u32, hits_per_page: u32) -> Result<(Vec<AlgoliaJob>, u32)> {
        let params = format!("hitsPerPage={hits_per_page}&page={page}");

        let body = serde_json::json!({
            "requests": [{
                "indexName": ALGOLIA_INDEX,
                "params": params
            }]
        });

        let resp = self
            .http
            .post(ALGOLIA_URL)
            .header("x-algolia-application-id", ALGOLIA_APP_ID)
            .header("x-algolia-api-key", ALGOLIA_API_KEY)
            .header("Content-Type", "application/json")
            .header("Referer", "https://www.welcometothejungle.com/")
            .json(&body)
            .send()
            .await
            .context("failed to query Algolia")?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Algolia returned {status}: {text}");
        }

        let data: AlgoliaResponse = resp.json().await.context("failed to parse Algolia response")?;

        let result = data
            .results
            .into_iter()
            .next()
            .context("empty results array from Algolia")?;

        debug!(
            page = result.page,
            nb_pages = result.nb_pages,
            nb_hits = result.nb_hits,
            hits = result.hits.len(),
            "fetched Algolia page"
        );

        Ok((result.hits, result.nb_pages))
    }
}
