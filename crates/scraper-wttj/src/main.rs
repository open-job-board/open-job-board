mod algolia;
mod mapper;

use anyhow::Result;
use common::client::{JobBoardClient, SubmitResult};
use tracing::{error, info, warn};

/// Maximum number of Algolia pages to scrape per run.
const MAX_PAGES: u32 = 10;
/// Jobs per Algolia page.
const HITS_PER_PAGE: u32 = 100;
/// Pause between job submissions to respect rate limits (milliseconds).
const SUBMIT_DELAY_MS: u64 = 650;
/// Pause after hitting a rate limit (seconds).
const RATE_LIMIT_PAUSE_SECS: u64 = 65;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("starting WTTJ scraper");

    let algolia = algolia::AlgoliaClient::new();
    let board = JobBoardClient::from_env()?;

    let mut total_created = 0u64;
    let mut total_duplicates = 0u64;
    let mut total_errors = 0u64;
    let mut total_skipped = 0u64;

    for page in 0..MAX_PAGES {
        info!(page, "fetching Algolia page");

        let (jobs, nb_pages) = match algolia.fetch_page(page, HITS_PER_PAGE).await {
            Ok(result) => result,
            Err(e) => {
                error!(page, error = %e, "failed to fetch page");
                break;
            }
        };

        if jobs.is_empty() {
            info!(page, "no more jobs, stopping");
            break;
        }

        for job in &jobs {
            let submission = match mapper::map_job(job) {
                Some(s) => s,
                None => {
                    total_skipped += 1;
                    continue;
                }
            };

            let title = submission.title.clone();
            let reference = submission
                .origin
                .reference
                .as_deref()
                .unwrap_or("?")
                .to_string();

            match board.submit(&submission).await {
                Ok(SubmitResult::Created { id }) => {
                    info!(id, title, reference, "created");
                    total_created += 1;
                }
                Ok(SubmitResult::Duplicate) => {
                    total_duplicates += 1;
                }
                Ok(SubmitResult::RateLimited) => {
                    warn!("rate limited, pausing for {RATE_LIMIT_PAUSE_SECS}s");
                    tokio::time::sleep(std::time::Duration::from_secs(RATE_LIMIT_PAUSE_SECS)).await;
                    // Retry once after pause.
                    match board.submit(&submission).await {
                        Ok(SubmitResult::Created { id }) => {
                            info!(id, title, reference, "created after retry");
                            total_created += 1;
                        }
                        Ok(SubmitResult::Duplicate) => {
                            total_duplicates += 1;
                        }
                        Ok(other) => {
                            warn!(title, ?other, "failed after rate limit retry");
                            total_errors += 1;
                        }
                        Err(e) => {
                            error!(title, error = %e, "submit error after retry");
                            total_errors += 1;
                        }
                    }
                }
                Ok(SubmitResult::ValidationError(msg)) => {
                    warn!(title, reference, msg, "validation error");
                    total_errors += 1;
                }
                Ok(SubmitResult::Error(msg)) => {
                    error!(title, reference, msg, "submit error");
                    total_errors += 1;
                }
                Err(e) => {
                    error!(title, reference, error = %e, "submit failed");
                    total_errors += 1;
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(SUBMIT_DELAY_MS)).await;
        }

        // Stop if we've reached the last page.
        if page + 1 >= nb_pages {
            info!("reached last Algolia page");
            break;
        }
    }

    info!(
        total_created,
        total_duplicates,
        total_skipped,
        total_errors,
        "scraping complete"
    );

    if total_created == 0 && total_errors > 0 {
        anyhow::bail!("no jobs created and {total_errors} errors occurred");
    }

    Ok(())
}
