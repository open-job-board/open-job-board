/* ============================================================
   Open Job Board — Job Board UI
   Calls Supabase PostgREST RPC directly from the browser.
   The anon key is intentionally public — RLS enforces read-only.
   ============================================================ */

const SUPABASE_URL = "https://ppubgurkauoptjsuyfff.supabase.co";
const ANON_KEY     = "sb_publishable_S9AJoMdDWsX1cPOXpM3LJw_pqdn9U0B";
const PAGE_SIZE    = 20;

let currentPage = 1;
let lastParams  = {};
let hasMore     = false;

// ============================================================
// API calls
// ============================================================

async function searchJobs(params, page) {
  const body = {
    query:          params.query    || null,
    country:        params.country  || null,
    city:           params.city     || null,
    remote:         params.remote   || null,
    employment:     params.employment || null,
    salary_min_val: params.salary_min ? Number(params.salary_min) : null,
    salary_max_val: params.salary_max ? Number(params.salary_max) : null,
    page_num:       page,
    page_size:      PAGE_SIZE + 1,
  };

  Object.keys(body).forEach((k) => { if (body[k] === null) delete body[k]; });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_jobs`, {
    method: "POST",
    headers: {
      "apikey":        ANON_KEY,
      "Authorization": `Bearer ${ANON_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }

  return res.json();
}

async function getJobDetail(jobId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_job_detail`, {
    method: "POST",
    headers: {
      "apikey":        ANON_KEY,
      "Authorization": `Bearer ${ANON_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }

  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ============================================================
// HTML helpers
// ============================================================

function esc(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function formatSalary(job) {
  if (!job.salary_min && !job.salary_max) return null;
  const currency = esc(job.salary_currency ?? "");
  const period   = job.salary_period ? `/ ${esc(job.salary_period)}` : "";
  if (job.salary_min && job.salary_max) {
    return `${currency} ${Number(job.salary_min).toLocaleString()}\u2013${Number(job.salary_max).toLocaleString()} ${period}`.trim();
  }
  const single = job.salary_min ?? job.salary_max;
  return `${currency} ${Number(single).toLocaleString()} ${period}`.trim();
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1mo ago";
  return `${months}mo ago`;
}

// ============================================================
// Rendering — Job cards
// ============================================================

function renderJob(job) {
  const location = [job.location_city, job.location_country].filter(Boolean).map(esc).join(", ");
  const posted   = timeAgo(job.posted_at);
  const salary   = formatSalary(job);

  const tags = [];
  if (job.remote_full) tags.push(`<span class="tag remote">Remote</span>`);
  else if (job.remote_days) tags.push(`<span class="tag remote">${esc(String(job.remote_days))}d/week remote</span>`);
  if (job.employment_type) tags.push(`<span class="tag">${esc(job.employment_type)}</span>`);
  if (salary) tags.push(`<span class="tag salary">${salary}</span>`);

  return `
    <article class="job-card" data-job-id="${esc(job.id)}" tabindex="0" role="button" aria-label="View details for ${esc(job.title)}">
      <div class="job-card-top">
        <div class="job-card-info">
          <h3 class="job-card-title">${esc(job.title)}</h3>
          <div class="job-card-meta">
            ${job.company_name ? `<span class="job-card-company">${esc(job.company_name)}</span>` : ""}
            ${location ? `<span class="job-card-location">${location}</span>` : ""}
          </div>
        </div>
        ${posted ? `<span class="job-card-date">${posted}</span>` : ""}
      </div>
      ${tags.length ? `<div class="job-tags">${tags.join("")}</div>` : ""}
    </article>
  `;
}

function renderResults(jobs, page) {
  const resultsDiv = document.getElementById("results");
  const header     = document.getElementById("results-header");
  const countEl    = document.getElementById("results-count");
  const pagination = document.getElementById("pagination");
  const prevBtn    = document.getElementById("prev-btn");
  const nextBtn    = document.getElementById("next-btn");
  const pageInfo   = document.getElementById("page-info");

  hasMore = jobs.length > PAGE_SIZE;
  const displayJobs = hasMore ? jobs.slice(0, PAGE_SIZE) : jobs;

  if (displayJobs.length === 0 && page === 1) {
    resultsDiv.innerHTML = "";
    header.hidden = true;
    pagination.hidden = true;
    showStatus("No jobs found matching your search.");
    return;
  }

  hideStatus();
  header.hidden = false;
  countEl.textContent = `Page ${page} \u2014 ${displayJobs.length} result${displayJobs.length !== 1 ? "s" : ""}`;

  resultsDiv.innerHTML = displayJobs.map(renderJob).join("");

  // Add click handlers to job cards
  resultsDiv.querySelectorAll(".job-card[data-job-id]").forEach((card) => {
    card.addEventListener("click", () => openJobDetail(card.dataset.jobId));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openJobDetail(card.dataset.jobId);
      }
    });
  });

  pagination.hidden  = page === 1 && !hasMore;
  prevBtn.disabled   = page <= 1;
  nextBtn.disabled   = !hasMore;
  pageInfo.textContent = `Page ${page}`;
}

// ============================================================
// Status messages
// ============================================================

function showStatus(msg, isError = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.hidden = false;
}

function hideStatus() {
  document.getElementById("status").hidden = true;
}

function showLoading() {
  showStatus("Searching\u2026");
  document.getElementById("results").innerHTML = "";
  document.getElementById("results-header").hidden = true;
  document.getElementById("pagination").hidden = true;
}

// ============================================================
// Job detail modal
// ============================================================

async function openJobDetail(jobId) {
  const modal   = document.getElementById("job-modal");
  const title   = document.getElementById("modal-title");
  const body    = document.getElementById("modal-body");

  modal.hidden = false;
  document.body.style.overflow = "hidden";
  title.textContent = "Loading\u2026";
  body.innerHTML = '<div class="status-message">Loading job details\u2026</div>';

  // Update URL hash
  history.pushState(null, "", `#job=${jobId}`);

  try {
    const job = await getJobDetail(jobId);
    if (!job) {
      title.textContent = "Not found";
      body.innerHTML = '<div class="status-message error">This job is no longer available.</div>';
      return;
    }
    renderJobDetail(job, title, body);
  } catch (err) {
    title.textContent = "Error";
    body.innerHTML = `<div class="status-message error">Failed to load job: ${esc(err.message)}</div>`;
  }
}

function renderJobDetail(job, titleEl, bodyEl) {
  titleEl.textContent = job.title || "Untitled";

  const location = [job.location_city, job.location_country].filter(Boolean).join(", ");
  const salary   = formatSalary(job);
  const posted   = formatDate(job.posted_at);

  let html = '<div class="job-detail">';

  // Meta bar
  html += '<div class="job-detail-meta">';
  if (job.company_name) html += `<span class="job-detail-company">${esc(job.company_name)}</span>`;
  if (location) html += `<span>${esc(location)}</span>`;
  if (posted) html += `<span>Posted ${posted}</span>`;
  html += '</div>';

  // Tags
  const tags = [];
  if (job.remote_full) tags.push(`<span class="tag remote">Remote</span>`);
  else if (job.remote_days) tags.push(`<span class="tag remote">${esc(String(job.remote_days))}d/week remote</span>`);
  if (job.employment_type) tags.push(`<span class="tag">${esc(job.employment_type)}</span>`);
  if (salary) tags.push(`<span class="tag salary">${salary}</span>`);
  if (job.company_sector) tags.push(`<span class="tag">${esc(job.company_sector)}</span>`);
  if (tags.length) html += `<div class="job-tags">${tags.join("")}</div>`;

  // Company info
  if (job.company_anecdote || job.company_website) {
    html += '<div class="job-detail-section">';
    html += '<h3>About the company</h3>';
    if (job.company_anecdote) html += `<p>${esc(job.company_anecdote)}</p>`;
    if (job.company_website) html += `<p><a href="${esc(job.company_website)}" target="_blank" rel="noopener">${esc(job.company_website)}</a></p>`;
    html += '</div>';
  }

  // Description
  if (job.description) {
    html += '<div class="job-detail-section">';
    html += '<h3>Description</h3>';
    html += `<div class="job-detail-description">${renderDescription(job.description)}</div>`;
    html += '</div>';
  }

  // Responsibilities
  if (job.responsibilities && job.responsibilities.length > 0) {
    html += '<div class="job-detail-section">';
    html += '<h3>Responsibilities</h3>';
    html += '<ul>';
    job.responsibilities.forEach((r) => { html += `<li>${esc(r)}</li>`; });
    html += '</ul>';
    html += '</div>';
  }

  // Requirements
  if (job.requirements) {
    const req = job.requirements;
    const hasSections = (req.qualifications && req.qualifications.length) ||
                        (req.hard_skills && req.hard_skills.length) ||
                        (req.soft_skills && req.soft_skills.length) ||
                        (req.others && req.others.length);
    if (hasSections) {
      html += '<div class="job-detail-section">';
      html += '<h3>Requirements</h3>';
      if (req.qualifications && req.qualifications.length) {
        html += '<h4>Qualifications</h4><ul>';
        req.qualifications.forEach((q) => { html += `<li>${esc(q)}</li>`; });
        html += '</ul>';
      }
      if (req.hard_skills && req.hard_skills.length) {
        html += '<h4>Technical Skills</h4><ul>';
        req.hard_skills.forEach((s) => { html += `<li>${esc(s)}</li>`; });
        html += '</ul>';
      }
      if (req.soft_skills && req.soft_skills.length) {
        html += '<h4>Soft Skills</h4><ul>';
        req.soft_skills.forEach((s) => { html += `<li>${esc(s)}</li>`; });
        html += '</ul>';
      }
      if (req.others && req.others.length) {
        html += '<h4>Other</h4><ul>';
        req.others.forEach((o) => { html += `<li>${esc(o)}</li>`; });
        html += '</ul>';
      }
      html += '</div>';
    }
  }

  // Benefits
  if (job.benefits && job.benefits.length > 0) {
    html += '<div class="job-detail-section">';
    html += '<h3>Benefits</h3>';
    html += '<ul>';
    job.benefits.forEach((b) => { html += `<li>${esc(b)}</li>`; });
    html += '</ul>';
    html += '</div>';
  }

  // Salary detail
  if (salary) {
    html += '<div class="job-detail-section">';
    html += '<h3>Compensation</h3>';
    html += `<p class="job-detail-salary">${salary}</p>`;
    html += '</div>';
  }

  // Contact
  if (job.contact) {
    const c = job.contact;
    if (c.name || c.email || c.phone) {
      html += '<div class="job-detail-section">';
      html += '<h3>Contact</h3>';
      if (c.name) html += `<p>${esc(c.name)}</p>`;
      if (c.email) html += `<p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>`;
      if (c.phone) html += `<p>${esc(c.phone)}</p>`;
      html += '</div>';
    }
  }

  html += '</div>';
  bodyEl.innerHTML = html;
}

function renderDescription(text) {
  // Convert plain text to paragraphs. Preserve line breaks.
  return esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function closeModal() {
  const modal = document.getElementById("job-modal");
  modal.hidden = true;
  document.body.style.overflow = "";
  // Remove job hash from URL
  if (location.hash.startsWith("#job=")) {
    history.pushState(null, "", location.pathname + location.search);
  }
}

// ============================================================
// Form handling
// ============================================================

function getParams() {
  return {
    query:      document.getElementById("q").value.trim(),
    country:    document.getElementById("country").value.trim(),
    employment: document.getElementById("employment").value,
    remote:     document.getElementById("remote").checked ? true : null,
  };
}

async function doSearch(params, page) {
  showLoading();
  try {
    const jobs = await searchJobs(params, page);
    renderResults(jobs, page);
  } catch (err) {
    showStatus(`Error: ${err.message}`, true);
  }
}

// ============================================================
// Event listeners
// ============================================================

document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  currentPage = 1;
  lastParams  = getParams();
  await doSearch(lastParams, currentPage);
});

document.getElementById("prev-btn").addEventListener("click", async () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  await doSearch(lastParams, currentPage);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("next-btn").addEventListener("click", async () => {
  if (!hasMore) return;
  currentPage += 1;
  await doSearch(lastParams, currentPage);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("clear-filters-btn").addEventListener("click", () => {
  document.getElementById("q").value = "";
  document.getElementById("country").value = "";
  document.getElementById("employment").value = "";
  document.getElementById("remote").checked = false;
  currentPage = 1;
  lastParams = {};
  doSearch(lastParams, 1);
});

// Modal close handlers
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-backdrop").addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// Handle back/forward with job hash
window.addEventListener("hashchange", () => {
  const hash = location.hash;
  if (hash.startsWith("#job=")) {
    openJobDetail(hash.slice(5));
  } else {
    closeModal();
  }
});

// ============================================================
// Initial load
// ============================================================

(async () => {
  // Check for job hash in URL
  const hash = location.hash;
  if (hash.startsWith("#job=")) {
    openJobDetail(hash.slice(5));
  }

  // Load recent jobs
  lastParams = {};
  await doSearch(lastParams, 1);
})();
