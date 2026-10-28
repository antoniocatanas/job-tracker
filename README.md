# Job Search Tracker

A private web app on top of the **Job Search Tracker** Airtable base (`appfZkhr2AnDVkuiD`, table `Jobs`).

- **Add job**: type a company, role and link. The job is added to Airtable as New and the "Complete job from tracker" Claude task fills in the rest (job description, location, segment, OTE, score and brief) using the same rubric as the daily search. Duplicates (same link, or same company and role) are caught before anything is saved.
- **Pipeline**: kanban by Status. Drag a card to another column to update it in Airtable.
- **Ranked**: every active job sorted by Score, with sortable columns and filters.
- **Generate CV & cover letter**: a tickbox in the job panel. Ticking it starts the "Draft CV & cover letter" Claude task, which writes both as Google Docs in the job's folder under Drive → Applications, sets the Drive folder link and marks the job Drafted. The app shows progress live and a Docs log tab with links.
- **Job panel**: Brief, Competitors (positioning plus at least two competitors with pros and cons, written by the Claude tasks), Job description, Interview prep (Assets) and editable Notes, plus Status, Application Status and Alive/Dead controls and links to the posting, Drive folder and meeting prep.

No framework and no npm dependencies: static files in `public/`, serverless functions in `api/`.

## How it's secured

- The Airtable token lives only in Vercel's environment variables. The browser only ever talks to `/api/*`.
- A password unlocks the app and sets a signed, HttpOnly cookie (30 days).
- The API can only edit **Status, Application Status, Select and Notes**, and select values must match the base's options. Nothing can be deleted.
- Pages are `noindex` and can't be framed.

## Deploy to Vercel (about 10 minutes)

### 1. Create an Airtable token
1. Go to <https://airtable.com/create/tokens> → **Create token**.
2. Name it `Job tracker web app`.
3. Scopes: `data.records:read` and `data.records:write`.
4. Access: add only the **Job Search Tracker** base.
5. Copy the token (starts with `pat`). You only see it once.

### 2. Put the code on GitHub
Create a new **private** repo (e.g. `job-tracker`) and upload this folder. Either drag the files into the GitHub web UI, or:
```bash
cd job-tracker
git init && git add . && git commit -m "Job tracker"
git branch -M main
git remote add origin https://github.com/<you>/job-tracker.git
git push -u origin main
```

### 3. Import into Vercel
1. Sign in at <https://vercel.com> with GitHub (the free Hobby plan is enough).
2. **Add New → Project** → pick the `job-tracker` repo.
3. Framework preset: **Other**. Leave build and output settings empty.
4. Open **Environment Variables** and add the five from `.env.example`:
   `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID`, `APP_PASSWORD`, `SESSION_SECRET`.
5. **Deploy**. You'll get a URL like `job-tracker-xxxx.vercel.app`.

Every push to `main` redeploys automatically. If you change an environment variable, redeploy from the Vercel dashboard for it to take effect.

## CV & cover letter generation and Add job auto-complete

Both run on an hourly check, so there's nothing to set up:

- Ticking **Generate CV & cover letter** sets the job's Docs status to "Requested". The scheduled task **Draft CV & cover letter (from job tracker)** runs every hour, drafts the docs for every "Requested" job, and sets them to "Ready".
- **Add job** saves the row with Autofill status "Requested". The scheduled task **Complete job from tracker** runs every hour and fills in every "Requested" job.

The app shows these as "queued" until Claude picks them up (up to an hour, then a few minutes of work).

### Optional: start instantly instead

If your account offers an API trigger for scheduled tasks (task → **Edit** → **Trigger** → **+** → **API**), you can make the app start Claude straight away. Add the Fire URL and token to Vercel and redeploy:

- Docs: `CLAUDE_TASK_FIRE_URL` and `CLAUDE_TASK_TOKEN`
- Add job: `CLAUDE_AUTOFILL_FIRE_URL` and `CLAUDE_AUTOFILL_TOKEN`

When those are set, the app fires the task right away; when they're missing, it falls back to the hourly queue. The hourly run still catches anything the instant trigger missed.

## Run it locally

Node 18+ is the only requirement.

```bash
npm run dev:mock      # fictional data, password "demo", no token needed
cp .env.example .env  # then fill it in
npm run dev           # your real base at http://localhost:3000
```

## Changing things

- **New select option in Airtable?** Add it to `CHOICES` in `lib/config.js`, or the app will reject it when saving.
- **Make another field editable?** Add it to `EDITABLE` in `lib/config.js` (and give it a control in `public/app.js`).
- **New field?** Add its field ID to `FIELD_IDS` and, if the board needs it, to `LIST_KEYS`. Fields are referenced by ID, so renaming a field in Airtable won't break anything.
- **Change the look:** colours and fonts are CSS variables at the top of `public/styles.css`. Dark mode follows your system setting.

## Files

```
api/login.js        POST password → session cookie
api/logout.js       POST → clears the cookie
api/session.js      GET → { signedIn }
api/autofill.js     POST { id } → retry "Complete job from tracker" for a job added by hand
api/jobs/index.js   GET → all jobs (light fields) + select options · POST adds a job by hand
api/jobs/[id].js    GET one job (all fields) · PATCH editable fields
api/generate.js     POST { id } → Docs status "Requested" + starts the Claude task
lib/claude.js       calls the Claude task's API trigger
lib/airtable.js     Airtable REST client, validation, rate-limit retry
lib/auth.js         password check + signed cookie
lib/config.js       field IDs, select options, editable fields
lib/mock.js         fictional data for MOCK=1
public/             the app (index.html, app.js, styles.css)
dev-server.mjs      local stand-in for Vercel
vercel.json         security headers
```
