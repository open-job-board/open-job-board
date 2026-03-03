use chrono::Utc;
use common::types::*;

use crate::algolia::AlgoliaJob;

/// Map a WTTJ Algolia job to the Open Job Board submission format.
pub fn map_job(job: &AlgoliaJob) -> Option<JobSubmission> {
    // Summary is used as description since Algolia doesn't expose full descriptions.
    let description = job.summary.as_deref().unwrap_or("").to_string();
    if description.is_empty() {
        return None;
    }

    let office = job.offices.as_ref().and_then(|o| o.first());

    let remote = job.remote.as_deref().map(|r| match r {
        "fulltime" => Remote {
            full: Some(true),
            days: None,
        },
        "partial" => Remote {
            full: Some(false),
            days: Some(2),
        },
        _ => Remote {
            full: Some(false),
            days: None,
        },
    });

    let location = Some(Location {
        city: office.and_then(|o| o.city.clone()),
        country: office.and_then(|o| o.country.clone()),
        remote,
    });

    let company = job.organization.as_ref().map(|org| {
        let website = org
            .slug
            .as_ref()
            .map(|s| format!("https://www.welcometothejungle.com/en/companies/{s}"));

        let sector = job
            .sectors
            .as_ref()
            .and_then(|s| s.first())
            .and_then(|s| s.name.clone());

        let anecdote = org.summary.clone();

        Company {
            name: org.name.clone(),
            website,
            sector,
            anecdote,
            location: None,
        }
    });

    let employment_type = job.contract_type.as_deref().map(|ct| match ct {
        "full_time" => "full-time",
        "part_time" => "part-time",
        "internship" => "internship",
        "apprenticeship" => "internship",
        "temporary" => "contract",
        "freelance" => "freelance",
        "vie" => "contract",
        other => other,
    }.to_string());

    let salary = match (&job.salary_currency, &job.salary_minimum, &job.salary_maximum) {
        (Some(currency), _, _) if job.salary_minimum.is_some() || job.salary_maximum.is_some() => {
            Some(Salary {
                currency: Some(currency.clone()),
                min: job.salary_minimum,
                max: job.salary_maximum,
                period: job.salary_period.clone(),
            })
        }
        _ => None,
    };

    Some(JobSubmission {
        origin: Origin {
            source: "welcometothejungle".to_string(),
            reference: Some(job.object_id.clone()),
            contact: None,
        },
        title: job.name.clone(),
        description,
        responsibilities: job.key_missions.clone(),
        company,
        employment_type,
        location,
        requirements: None,
        salary,
        benefits: job.benefits.clone(),
        posted_at: job.published_at.clone(),
        parsed_at: Some(Utc::now().to_rfc3339()),
    })
}
