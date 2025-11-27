const https = require('https');
const http = require('http');

const BASE_URL = process.argv[2] || 'https://quiz.tsblive.in';
const CONCURRENT_USERS = parseInt(process.argv[3]) || 100;
const DURATION_SECONDS = parseInt(process.argv[4]) || 30;

console.log(`\n========================================`);
console.log(`  Load Test: ${BASE_URL}`);
console.log(`  Users: ${CONCURRENT_USERS} | Duration: ${DURATION_SECONDS}s`);
console.log(`========================================\n`);

const results = {
  total: 0,
  success: 0,
  failed: 0,
  times: [],
  errors: {}
};

const startTime = Date.now();
const endTime = startTime + (DURATION_SECONDS * 1000);

function makeRequest() {
  return new Promise((resolve) => {
    const reqStart = Date.now();
    const url = new URL('/health', BASE_URL);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get(url.href, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - reqStart;
        results.total++;
        if (res.statusCode === 200) {
          results.success++;
          results.times.push(duration);
        } else {
          results.failed++;
          results.errors[res.statusCode] = (results.errors[res.statusCode] || 0) + 1;
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      results.total++;
      results.failed++;
      const errType = err.code || 'UNKNOWN';
      results.errors[errType] = (results.errors[errType] || 0) + 1;
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      results.total++;
      results.failed++;
      results.errors['TIMEOUT'] = (results.errors['TIMEOUT'] || 0) + 1;
      resolve();
    });
  });
}

async function runUser() {
  while (Date.now() < endTime) {
    await makeRequest();
    // Small delay between requests per user
    await new Promise(r => setTimeout(r, 100));
  }
}

async function main() {
  // Start all virtual users
  const users = [];
  for (let i = 0; i < CONCURRENT_USERS; i++) {
    users.push(runUser());
    // Stagger user starts slightly
    if (i < CONCURRENT_USERS - 1) {
      await new Promise(r => setTimeout(r, 10));
    }
  }

  // Progress indicator
  const progressInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = DURATION_SECONDS - elapsed;
    process.stdout.write(`\r  Progress: ${elapsed}s / ${DURATION_SECONDS}s | Requests: ${results.total} | Failed: ${results.failed}   `);
  }, 1000);

  await Promise.all(users);
  clearInterval(progressInterval);

  // Calculate stats
  const sorted = results.times.sort((a, b) => a - b);
  const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const min = sorted[0] || 0;
  const max = sorted[sorted.length - 1] || 0;
  const rps = results.total / DURATION_SECONDS;
  const failRate = results.total > 0 ? (results.failed / results.total * 100) : 0;

  console.log(`\n\n========================================`);
  console.log(`  RESULTS`);
  console.log(`========================================`);
  console.log(`  Total Requests:  ${results.total}`);
  console.log(`  Successful:      ${results.success}`);
  console.log(`  Failed:          ${results.failed} (${failRate.toFixed(2)}%)`);
  console.log(`  Requests/sec:    ${rps.toFixed(2)}`);
  console.log(`----------------------------------------`);
  console.log(`  Response Times (ms):`);
  console.log(`    Avg:  ${avg.toFixed(0)}ms`);
  console.log(`    Min:  ${min}ms`);
  console.log(`    Max:  ${max}ms`);
  console.log(`    p50:  ${p50}ms`);
  console.log(`    p90:  ${p90}ms`);
  console.log(`    p95:  ${p95}ms`);

  if (Object.keys(results.errors).length > 0) {
    console.log(`----------------------------------------`);
    console.log(`  Errors:`);
    for (const [code, count] of Object.entries(results.errors)) {
      console.log(`    ${code}: ${count}`);
    }
  }

  console.log(`========================================\n`);

  // Verdict
  if (failRate < 1 && p95 < 1000) {
    console.log(`  ✅ PASSED - Server handles ${CONCURRENT_USERS} users well`);
  } else if (failRate < 5 && p95 < 3000) {
    console.log(`  ⚠️  WARNING - Some degradation at ${CONCURRENT_USERS} users`);
  } else {
    console.log(`  ❌ FAILED - Server struggles at ${CONCURRENT_USERS} users`);
  }
  console.log('');
}

main().catch(console.error);
