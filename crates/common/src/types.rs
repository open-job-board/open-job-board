use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct JobSubmission {
    pub origin: Origin,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responsibilities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company: Option<Company>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub employment_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Location>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirements: Option<Requirements>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salary: Option<Salary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub benefits: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub posted_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Origin {
    pub source: String,
    pub reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact: Option<Contact>,
}

#[derive(Debug, Serialize)]
pub struct Contact {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Company {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anecdote: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct Location {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<Remote>,
}

#[derive(Debug, Serialize)]
pub struct Remote {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct Requirements {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qualifications: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hard_skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soft_skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub others: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct Salary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period: Option<String>,
}

/// Response from the submit-job endpoint.
#[derive(Debug, Deserialize)]
pub struct SubmitResponse {
    pub id: Option<String>,
    pub message: Option<String>,
    pub details: Option<serde_json::Value>,
}
