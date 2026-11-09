process.env.ALLOW_SHARED_LOGIN = '1'; // the watchdog signs in with its own secrets
import { writeFileSync } from 'node:fs';
import { checkPortal, formatReport } from '../src/portal-check.js';

const result = await checkPortal();
const report = formatReport(result);
console.log(report);
writeFileSync('portal-report.md', report);
process.exit(result.ok ? 0 : 1);
