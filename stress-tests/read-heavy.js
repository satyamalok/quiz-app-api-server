import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// ============= READ-HEAVY TEST =============
// Tests read endpoints with pre-authenticated users
// Simulates users browsing profile, leaderboard, etc.

const BASE_URL = 'https://jnvquiz.tsblive.in';
const APP_SLUG = 'computer';

const readSuccessRate = new Rate('read_success_rate');

export const options = {
  scenarios: {
    read_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '1m', target: 300 },
        { duration: '30s', target: 500 },
        { duration: '1m', target: 500 },   // Hold at peak
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // Read ops should be fast
    read_success_rate: ['rate>0.95'],
  },
};

function getUrl(endpoint) {
  return `${BASE_URL}/api/v1/${APP_SLUG}${endpoint}`;
}

const headers = { 'Content-Type': 'application/json' };

// Shared token storage (populated in setup)
let tokens = [];

export function setup() {
  // Create 50 test users and get their tokens
  const setupTokens = [];

  for (let i = 0; i < 50; i++) {
    const phone = '88888' + String(i).padStart(5, '0');

    const otpRes = http.post(
      getUrl('/auth/send-otp'),
      JSON.stringify({ phone }),
      { headers }
    );

    if (otpRes.status !== 200) continue;

    const otp = otpRes.json('test_mode_otp');
    if (!otp) continue;

    const verifyRes = http.post(
      getUrl('/auth/verify-otp'),
      JSON.stringify({ phone, otp, name: `ReadUser_${i}`, medium: 'english' }),
      { headers }
    );

    if (verifyRes.status === 200) {
      setupTokens.push(verifyRes.json('token'));
    }

    sleep(0.1);
  }

  console.log(`Setup complete: ${setupTokens.length} tokens created`);
  return { tokens: setupTokens };
}

export default function (data) {
  if (!data.tokens || data.tokens.length === 0) {
    console.log('No tokens available');
    return;
  }

  // Pick a random token
  const token = data.tokens[Math.floor(Math.random() * data.tokens.length)];
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // Random read operation
  const ops = ['profile', 'leaderboard', 'stats'];
  const op = ops[Math.floor(Math.random() * ops.length)];

  let res;
  switch (op) {
    case 'profile':
      res = http.get(getUrl('/user/profile'), { headers: authHeaders });
      break;
    case 'leaderboard':
      res = http.get(getUrl('/leaderboard/daily'), { headers: authHeaders });
      break;
    case 'stats':
      res = http.get(getUrl('/user/stats'), { headers: authHeaders });
      break;
  }

  const success = check(res, {
    'Read successful': (r) => r.status === 200,
  });

  readSuccessRate.add(success);

  sleep(Math.random() * 0.5 + 0.1);
}

export function handleSummary(data) {
  console.log('\n========== READ-HEAVY TEST RESULTS ==========');
  console.log(`Total Requests: ${data.metrics.http_reqs?.values?.count || 0}`);
  console.log(`Success Rate: ${((data.metrics.read_success_rate?.values?.rate || 0) * 100).toFixed(2)}%`);
  console.log(`Avg Response: ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms`);
  console.log(`P95 Response: ${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms`);
  console.log('==============================================\n');

  return {
    'read-heavy-results.json': JSON.stringify(data, null, 2),
  };
}
