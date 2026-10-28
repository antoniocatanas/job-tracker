// Field IDs from the "Jobs" table (tblKHpUH7X7azesgP).
// Using IDs rather than names means renaming a field in Airtable won't break the app.
export const FIELD_IDS = {
  company: 'fld2u4Iv5JchgCiaB', // Company
  role: 'fld5S1qy6VJpTko1X', // Role
  link: 'fldOuaoSXeAlv20Wf', // Link
  location: 'fldpyZ1yeJiJNoVH4', // Location
  segment: 'fldWWRWJWiVAGkxu3', // Segment
  dateFound: 'fldGbxv6LcKaSIFuh', // Date found
  score: 'fldvpyujPFor7Fn9V', // Score
  status: 'flddQ5xiQ4R80BsL7', // Status
  ote: 'fld9FNVA5OVgA0YKn', // OTE
  brief: 'fldjswJ8AmFril5HA', // Brief
  jd: 'fldL6lJqEUHhGatW2', // Job Description
  driveFolder: 'fldHj6A9qAJL15qBe', // Drive folder
  notes: 'fld5OsXugibU1n8Hn', // Notes
  appStatus: 'fldbYvYgTwAmjVXu2', // Application Status
  meetingPrep: 'fldj6uCubRrAkyn8U', // Meeting Prep
  select: 'fldrkAFG23FbtQ25N', // Select (Alive / Dead)
  assets: 'fld24HhWUrbiYBX6U', // Assets (interview prep, rich text)
  docsStatus: 'fldGVXrZuFoUXd4gf', // Docs status (CV + cover letter generation)
  docsLog: 'fldyM94zDAKGBIX39', // Docs log (written by the Claude task)
  autofillStatus: 'fldPL3Pq55aI7BIFZ', // Autofill status (manually added jobs, filled in by Claude)
  competitors: 'fldTfwQOfeRi2HCWj', // Competitive analysis (written by the Claude tasks)
};

// Light fields loaded for the board and table. Long text is fetched per job.
export const LIST_KEYS = [
  'company', 'role', 'link', 'location', 'segment', 'dateFound', 'score',
  'status', 'ote', 'appStatus', 'select', 'driveFolder', 'meetingPrep', 'docsStatus', 'autofillStatus',
];

export const DETAIL_KEYS = Object.keys(FIELD_IDS);

// Single-select options, copied exactly from the base (some have trailing spaces).
// If you add an option in Airtable, add it here too.
export const CHOICES = {
  status: ['New', 'Shortlisted', 'Drafted', 'Applied', 'Interviewing', 'Rejected', 'Skipped', 'JD unavailable'],
  appStatus: ['Submitted', 'Screening', 'Second Stage ', 'Third Stage (Onsite/Mock Call) ', 'Rejected', 'No Longer Active'],
  select: ['Alive', 'Dead '],
  location: [
    'London on-site/hybrid', 'UK remote', 'Paris (remote from London)', 'Paris (relocation)',
    'Lisbon (remote from London)', 'Lisbon (relocation)', 'Unclear',
  ],
  segment: ['SMB', 'Commercial', 'Mid-Market', 'Enterprise'],
  docsStatus: ['Requested', 'Drafting', 'Ready', 'Failed'],
  autofillStatus: ['Requested', 'Researching', 'Done', 'Failed'],
};

// Limits for jobs added by hand from the app.
export const NEW_JOB_LIMITS = { company: 120, role: 200, link: 2000 };

// Fields the app is allowed to write. Everything else is read-only.
export const EDITABLE = {
  status: 'select',
  appStatus: 'select',
  select: 'select',
  notes: 'text',
};
