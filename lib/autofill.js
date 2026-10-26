import { writeFields } from './airtable.js';
import { fireAutofillTask } from './claude.js';
import * as mock from './mock.js';

// Starts the "Complete job from tracker" Claude task for a job whose Autofill status is "Requested".
// If Claude can't be reached, the job is marked Failed with the reason in Brief, so it can be retried.
export async function startAutofill(id, job) {
  if (process.env.MOCK === '1') {
    mock.simulateAutofill(id);
    return { job, started: true };
  }
  try {
    await fireAutofillTask(id);
    return { job, started: true };
  } catch (err) {
    const saved = await writeFields(id, {
      autofillStatus: 'Failed',
      brief: `AUTO-COMPLETE FAILED\nCould not start Claude: ${err.message}`,
    }).catch(() => job);
    return { job: saved, started: false, error: err.message };
  }
}
