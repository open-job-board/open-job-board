-- =============================================================================
-- Seed data — realistic sample jobs for development and testing
-- =============================================================================

INSERT INTO public.jobs (
  source, reference, title, description,
  responsibilities, benefits,
  employment_type,
  company_name, company_website, company_sector, company_anecdote, company_locations,
  location_city, location_country, remote_full, remote_days,
  requirements,
  salary_currency, salary_min, salary_max, salary_period,
  posted_at, parsed_at
) VALUES

-- 1. Senior Backend Engineer — Berlin, full remote
(
  'seed', 'seed-001',
  'Senior Backend Engineer (Go)',
  'We are looking for a senior backend engineer to join our platform team. You will design and build scalable APIs, own our data infrastructure, and mentor junior engineers.',
  '["Design and build scalable REST and gRPC APIs","Own database schema design and query optimization","Lead code reviews and mentor junior engineers","Collaborate with product and frontend teams"]',
  '["30 days paid vacation","Full health and dental insurance","€2,000 annual learning budget","Home office stipend €1,500","Company laptop"]',
  'full-time',
  'Acme Logistics', 'https://acmelogistics.example', 'Logistics & Supply Chain',
  'We are reimagining last-mile delivery for Europe, processing over 2 million shipments per month.',
  '["Berlin, Germany","Amsterdam, Netherlands"]',
  'Berlin', 'Germany', true, NULL,
  '{"qualifications":["5+ years professional backend experience","BSc in Computer Science or equivalent"],"hard_skills":["Go","PostgreSQL","Kubernetes","gRPC","Redis"],"soft_skills":["Strong written communication","Ownership mindset"],"others":[]}',
  'EUR', 90000, 130000, 'yearly',
  now() - interval '1 day', now() - interval '1 day' + interval '75 minutes'
),

-- 2. Frontend Engineer — Paris, hybrid
(
  'seed', 'seed-002',
  'Frontend Engineer (React / TypeScript)',
  'Join our product team in Paris to build beautiful, accessible user interfaces for our B2B SaaS platform. You will own the frontend architecture and work closely with design.',
  '["Build and maintain React components","Drive our migration from JavaScript to TypeScript","Implement accessibility standards (WCAG AA)","Write unit and integration tests"]',
  '["25 days vacation","Restaurant vouchers (Swile)","Public transport reimbursement 100%","Flexible working hours"]',
  'full-time',
  'DataViz Pro', 'https://datavizpro.example', 'SaaS / Analytics',
  'We help 500+ companies visualize their data in real time. Series A funded, 45-person team.',
  '["Paris, France"]',
  'Paris', 'France', false, 2,
  '{"qualifications":["3+ years React experience"],"hard_skills":["React","TypeScript","Vite","Vitest","CSS Modules"],"soft_skills":["Attention to detail","Collaboration"],"others":["Experience with design systems"]}',
  'EUR', 60000, 80000, 'yearly',
  now() - interval '2 days', now() - interval '2 days' + interval '90 minutes'
),

-- 3. Staff ML Engineer — London, full remote
(
  'seed', 'seed-003',
  'Staff Machine Learning Engineer',
  'We are hiring a staff ML engineer to lead our recommendation engine and fraud detection systems. You will set the technical direction for the ML platform and grow a team of 4 engineers.',
  '["Lead the design of our ML training and serving infrastructure","Build real-time fraud detection models processing 50k events/sec","Hire and mentor ML engineers","Partner with data science and product teams"]',
  '["35 days vacation","£10,000 annual equity refresh","BUPA private health","Remote-first culture","Quarterly team off-sites"]',
  'full-time',
  'Finly', 'https://finly.example', 'Fintech',
  'Finly is a next-generation expense management platform trusted by 3,000+ companies in the UK and EU.',
  '["London, UK","Remote"]',
  'London', 'United Kingdom', true, NULL,
  '{"qualifications":["8+ years in ML/data engineering","Experience leading ML teams"],"hard_skills":["Python","PyTorch","Spark","Kafka","Feature stores"],"soft_skills":["Strategic thinking","Clear communication"],"others":["Experience with real-time ML serving"]}',
  'GBP', 140000, 180000, 'yearly',
  now() - interval '3 days', now() - interval '3 days' + interval '60 minutes'
),

-- 4. DevOps / Platform Engineer — Remote, worldwide
(
  'seed', 'seed-004',
  'Platform Engineer (Kubernetes / Terraform)',
  'Help us build and operate a world-class developer platform on AWS. You will own our Kubernetes clusters, CI/CD pipelines, and observability stack.',
  '["Manage multi-region EKS clusters","Build internal developer tooling and golden paths","Improve CI/CD pipeline performance","Own incident response and on-call rotation"]',
  '["Fully remote, async-first culture","$5,000 home office budget","Unlimited PTO (minimum 20 days)","Annual company retreat"]',
  'full-time',
  'OpenCloud Labs', 'https://opencloudlabs.example', 'Cloud Infrastructure',
  'We build open-source developer tools used by over 50,000 engineers worldwide.',
  '["Remote"]',
  NULL, NULL, true, NULL,
  '{"qualifications":["4+ years in platform/infrastructure roles"],"hard_skills":["Kubernetes","Terraform","AWS","ArgoCD","Prometheus","Grafana"],"soft_skills":["Reliability mindset","Documentation discipline"],"others":[]}',
  'USD', 120000, 160000, 'yearly',
  now() - interval '4 days', now() - interval '4 days' + interval '90 minutes'
),

-- 5. Product Designer — Amsterdam, on-site
(
  'seed', 'seed-005',
  'Senior Product Designer',
  'We are looking for a senior product designer to own the end-to-end design of our mobile and web applications. You will collaborate directly with engineers and run user research sessions.',
  '["Lead UX research and usability testing","Design user flows, wireframes, and high-fidelity prototypes","Maintain and evolve our design system","Work closely with engineering to ensure pixel-perfect implementation"]',
  '["26 days vacation","NS Business card (public transport)","Pension plan","Annual design conference budget"]',
  'full-time',
  'Travelify', 'https://travelify.example', 'Travel & Hospitality',
  'Travelify makes group travel seamless, with 1M+ trips booked since 2020.',
  '["Amsterdam, Netherlands"]',
  'Amsterdam', 'Netherlands', false, NULL,
  '{"qualifications":["5+ years product design experience","Strong portfolio demonstrating end-to-end design process"],"hard_skills":["Figma","Protopie","User research methods"],"soft_skills":["Empathy","Storytelling","Facilitation"],"others":[]}',
  'EUR', 65000, 90000, 'yearly',
  now() - interval '5 days', now() - interval '5 days' + interval '60 minutes'
),

-- 6. Backend Developer (Python) — Remote EU
(
  'seed', 'seed-006',
  'Backend Developer (Python / FastAPI)',
  'Join a small but mighty team building data pipelines and APIs for the healthcare industry. You will work on high-stakes, high-impact software used by clinicians and researchers.',
  '["Build and maintain REST APIs with FastAPI","Design ETL pipelines for medical data","Ensure GDPR and HIPAA compliance in data handling","Write comprehensive tests and documentation"]',
  '["Remote in EU timezone","25 days vacation","Team retreats 2x/year","Learning budget €1,500/year"]',
  'full-time',
  'HealthBridge', 'https://healthbridge.example', 'HealthTech',
  'HealthBridge connects 200+ hospitals with research institutions to accelerate clinical trials.',
  '["Remote (EU)"]',
  NULL, NULL, true, NULL,
  '{"qualifications":["3+ years Python backend experience"],"hard_skills":["Python","FastAPI","PostgreSQL","dbt","Airflow"],"soft_skills":["Attention to compliance and quality","Clear documentation habits"],"others":["Experience with healthcare data standards (HL7, FHIR) is a plus"]}',
  'EUR', 70000, 95000, 'yearly',
  now() - interval '6 days', now() - interval '6 days' + interval '30 minutes'
),

-- 7. iOS Engineer — Munich, hybrid
(
  'seed', 'seed-007',
  'iOS Engineer (Swift / SwiftUI)',
  'Build delightful mobile experiences for millions of users. You will join our mobile team in Munich and work on our flagship iOS app, used by 3M+ active users.',
  '["Build and ship new iOS features using SwiftUI","Optimize app performance and battery usage","Collaborate with the design team on new interactions","Participate in code reviews and technical planning"]',
  '["28 days vacation","Deutschlandticket","Dog-friendly office","Beer fridge (it''s Munich)","Stock options"]',
  'full-time',
  'PocketCoach', 'https://pocketcoach.example', 'Health & Fitness',
  'PocketCoach is a top-3 fitness app in the DACH region with 3M+ monthly active users.',
  '["Munich, Germany"]',
  'Munich', 'Germany', false, 1,
  '{"qualifications":["3+ years iOS development","Published apps in the App Store"],"hard_skills":["Swift","SwiftUI","Combine","Xcode","REST APIs"],"soft_skills":["User empathy","Iterative mindset"],"others":["Experience with HealthKit is a bonus"]}',
  'EUR', 75000, 105000, 'yearly',
  now() - interval '1 day' - interval '12 hours', now() - interval '1 day' - interval '11 hours'
),

-- 8. Data Analyst — Madrid, hybrid
(
  'seed', 'seed-008',
  'Data Analyst',
  'We are looking for a data analyst to turn raw data into actionable insights for our marketing, product, and operations teams. You will own our analytics dashboard and reporting.',
  '["Build and maintain dashboards in Metabase/Looker","Write complex SQL queries to answer ad-hoc business questions","Partner with product to define and track key metrics","Present findings to senior leadership monthly"]',
  '["23 days vacation","Flexible hours","Health insurance","Spanish language lessons for non-native speakers"]',
  'full-time',
  'Shopmate', 'https://shopmate.example', 'E-Commerce',
  'Shopmate is a social shopping platform connecting 5M+ buyers and sellers across Southern Europe.',
  '["Madrid, Spain","Barcelona, Spain"]',
  'Madrid', 'Spain', false, 2,
  '{"qualifications":["2+ years as a data analyst"],"hard_skills":["SQL","Python (pandas)","Looker or Metabase","dbt"],"soft_skills":["Business acumen","Clear communication of complex data"],"others":[]}',
  'EUR', 38000, 52000, 'yearly',
  now() - interval '2 days' - interval '12 hours', now() - interval '2 days' - interval '11 hours'
),

-- 9. Security Engineer — Remote, worldwide
(
  'seed', 'seed-009',
  'Application Security Engineer',
  'Help us build secure software from the ground up. You will run threat modelling sessions, own our bug bounty program, and work with engineering teams to fix vulnerabilities.',
  '["Perform code reviews focused on security","Run threat modelling and penetration testing","Triage and manage our HackerOne bug bounty program","Build security tooling and automation"]',
  '["Fully remote","$150k–$190k depending on experience","$10,000 equipment budget","Conference and training budget $5,000/year"]',
  'full-time',
  'Vaultly', 'https://vaultly.example', 'Cybersecurity',
  'Vaultly is a zero-knowledge password manager with 2M+ users and SOC 2 Type II certified.',
  '["Remote"]',
  NULL, NULL, true, NULL,
  '{"qualifications":["4+ years in application or product security","OSCP, CEH, or equivalent preferred"],"hard_skills":["OWASP","Burp Suite","Static analysis tools","AWS security","Python or Go for tooling"],"soft_skills":["Collaborative by nature","Ability to explain security risks to non-engineers"],"others":[]}',
  'USD', 150000, 190000, 'yearly',
  now() - interval '3 days' - interval '12 hours', now() - interval '3 days' - interval '11 hours'
),

-- 10. Part-time Technical Writer — Remote
(
  'seed', 'seed-010',
  'Technical Writer (API Documentation)',
  'We need a technical writer to own our developer documentation — API references, quickstart guides, tutorials, and SDK docs. This is a part-time remote contract role.',
  '["Write and maintain API reference documentation","Create getting-started guides and tutorials","Work with engineers to document new features","Improve the developer experience of our docs site"]',
  '["Flexible hours (20h/week)","Fully remote","Hourly contract with 6-month renewal option"]',
  'part-time',
  'DevHub', 'https://devhub.example', 'Developer Tools',
  'DevHub makes it easy to build, test, and deploy APIs. Trusted by 30,000+ developers.',
  '["Remote"]',
  NULL, NULL, true, NULL,
  '{"qualifications":["3+ years technical writing experience","Experience documenting REST APIs"],"hard_skills":["OpenAPI / Swagger","Markdown","Git","Docs-as-code workflows"],"soft_skills":["Clarity and precision in writing","Empathy for developers"],"others":["Experience with tools like Docusaurus, MkDocs, or ReadMe is a plus"]}',
  'USD', 55, 75, 'hourly',
  now() - interval '4 days' - interval '12 hours', now() - interval '4 days' - interval '11 hours'
);
