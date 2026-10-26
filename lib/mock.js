// Fictional data for trying the UI without an Airtable token (MOCK=1). Never used in production.
import { CHOICES } from './config.js';

const companies = [
  'Northwind Labs', 'Brightpath', 'Kestrel AI', 'Ledgerly', 'Orbitly', 'Pinecrest Data', 'Quanta Flow',
  'Riverstone', 'Sablecloud', 'Tidewater', 'Umbra Security', 'Vantage HR', 'Willow Pay', 'Xenon Ops',
  'Yardline', 'Zephyr CRM', 'Atlas Freight', 'Beacon Health', 'Cobalt Legal', 'Driftwood', 'Ember Analytics',
  'Fable Commerce', 'Granite Docs', 'Harbor Fintech', 'Iris Workflows', 'Juniper Cloud', 'Koala Payroll',
  'Lumen Sales', 'Meridian Tax', 'Nimbus Retail',
];
const roles = ['Account Executive', 'Mid-Market Account Executive', 'Commercial AE (EMEA)', 'Enterprise Account Executive', 'Founding AE', 'Account Executive, France'];
const otes = ['Not listed', '£120k–£140k OTE', '£90k base, £180k OTE', '€80k–€110k OTE', '£150k OTE'];
const statusWeights = ['New', 'New', 'New', 'New', 'Shortlisted', 'Shortlisted', 'Drafted', 'Applied', 'Applied', 'Interviewing', 'Rejected', 'Skipped', 'Skipped', 'JD unavailable'];

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const store = new Map();
companies.concat(companies.slice(0, 12)).forEach((company, i) => {
  const id = 'rec' + String(i).padStart(4, '0') + 'MockRecord'.slice(0, 10);
  const status = pick(statusWeights);
  const score = Math.round(30 + rand() * 60);
  const day = String(1 + Math.floor(rand() * 22)).padStart(2, '0');
  store.set(id, {
    id,
    createdTime: `2026-10-${day}T09:00:00.000Z`,
    company,
    role: pick(roles),
    link: 'https://example.com/jobs/' + i,
    location: pick(CHOICES.location),
    segment: pick(CHOICES.segment),
    dateFound: `2026-10-${day}`,
    score,
    status,
    ote: pick(otes),
    appStatus: ['Applied', 'Interviewing'].includes(status) ? pick(CHOICES.appStatus.slice(0, 4)) : null,
    select: ['Applied', 'Interviewing'].includes(status) ? 'Alive' : null,
    driveFolder: rand() > 0.6 ? 'https://drive.google.com/' : null,
    meetingPrep: status === 'Interviewing' ? 'https://example.com/prep' : null,
    brief: `SCORE ${score}/100\n- Role & segment: 20/25 — sample text.\n- Experience match: 14/20 — sample text.\n\nREQUIREMENTS MET (CV evidence)\n- Full-cycle closing → sample evidence\n- Self-sourced pipeline → sample evidence\n\nPARTIAL\n- Multi-threading into larger accounts → sample\n\nNOT COVERED\n- Industry experience → sample\n\nINTERVIEW APPROACH\nThis is placeholder text for testing the layout.\n\nFLAGS\n- OTE not listed.\n\nSOURCES\n- https://example.com/source-one`,
    jd: `${pick(roles)} — ${company}\n\nAbout the role\nPlaceholder job description used to test the layout.\n\nResponsibilities\n- Own the full sales cycle\n- Build pipeline\n- Forecast accurately`,
    notes: rand() > 0.5 ? 'Placeholder note.' : null,
    assets: rand() > 0.5 ? '# Prep\n\n**Story 1:** placeholder\n\n- Point one\n- Point two\n\n[Company site](https://example.com)' : null,
  });
});

const pickKeys = (job, keys) => Object.fromEntries([['id', job.id], ['createdTime', job.createdTime], ...keys.map((k) => [k, job[k] ?? null])]);

export function list(keys) {
  return [...store.values()].map((j) => pickKeys(j, keys));
}

export function get(id, keys) {
  const job = store.get(id);
  if (!job) throw Object.assign(new Error('Record not found'), { status: 404 });
  return pickKeys(job, keys);
}

export function update(id, patch, keys) {
  const job = store.get(id);
  if (!job) throw Object.assign(new Error('Record not found'), { status: 404 });
  Object.assign(job, patch);
  return pickKeys(job, keys);
}

// Mimics the Claude task in mock mode: Requested → Drafting → Ready.
export function simulateDocs(id) {
  const job = store.get(id);
  if (!job) return;
  setTimeout(() => { job.docsStatus = 'Drafting'; }, 2000);
  setTimeout(() => {
    job.docsStatus = 'Ready';
    job.status = ['New', 'Shortlisted'].includes(job.status) ? 'Drafted' : job.status;
    job.driveFolder ||= 'https://drive.google.com/';
    job.docsLog = `${job.docsLog || ''}\nDrafted (mock).\nCV: https://docs.google.com/document/d/mock-cv\nCover letter: https://docs.google.com/document/d/mock-cl`;
  }, 6000);
}

let created = 0;
export function create(fields, keys) {
  const id = 'recNew' + String(++created).padStart(11, '0');
  store.set(id, { id, createdTime: new Date().toISOString(), ...fields });
  return pickKeys(store.get(id), keys);
}

// Mimics "Complete job from tracker" in mock mode: Requested → Researching → Done.
export function simulateAutofill(id) {
  const job = store.get(id);
  if (!job) return;
  setTimeout(() => { job.autofillStatus = 'Researching'; }, 2000);
  setTimeout(() => {
    const score = 68;
    Object.assign(job, {
      autofillStatus: 'Done',
      location: 'London on-site/hybrid',
      segment: 'Mid-Market',
      ote: '£130k OTE',
      score,
      jd: `${job.role} — ${job.company}\n\nPlaceholder job description fetched from the link (mock).`,
      brief: `SCORE ${score}/100\n- Role & segment: 20/20 — mock.\n\nREQUIREMENTS MET (CV evidence)\n- Full-cycle closing → AE, ESB\n\nFLAGS\n- Added manually (mock).`,
    });
  }, 7000);
}
