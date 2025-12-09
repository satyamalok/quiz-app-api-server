import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

// ============= SSD + 6 WORKERS STRESS TEST =============
// Now we know it's SSD - push much harder!
// 6 PM2 workers, 180 DB connections

const BASE_URL = 'https://jnvquiz.tsblive.in';
const APP_SLUG = 'computer';
const PHONE_PREFIX = '77777'; // New prefix
const CORRECT_ANSWER = 1;

const errorCounter = new Counter('errors');
const successRate = new Rate('success_rate');
const quizCompleteRate = new Rate('quiz_complete_rate');

export const options = {
  scenarios: {
    ssd_test: {
      executor: 'ramping-arrival-rate',
      startRate: 200,         // Start at 200 req/s
      timeUnit: '1s',
      preAllocatedVUs: 800,
      maxVUs: 1200,
      stages: [
        { duration: '30s', target: 200 },  // Stage 1: Known stable
        { duration: '30s', target: 300 },  // Stage 2: Previous ceiling
        { duration: '45s', target: 400 },  // Stage 3: New territory
        { duration: '45s', target: 500 },  // Stage 4: Push hard
        { duration: '45s', target: 600 },  // Stage 5: Find limit
        { duration: '60s', target: 600 },  // Stage 6: Sustained peak
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.10'],
    success_rate: ['rate>0.85'],
  },
};

function getUrl(endpoint) {
  return `${BASE_URL}/api/v1/${APP_SLUG}${endpoint}`;
}

function generatePhone(vuId, iteration) {
  const num = (vuId * 10000 + iteration) % 100000;
  return PHONE_PREFIX + String(num).padStart(5, '0');
}

const headers = { 'Content-Type': 'application/json' };

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

export default function () {
  const phone = generatePhone(__VU, __ITER);
  let token = null;

  // === Auth Flow ===
  const otpRes = http.post(
    getUrl('/auth/send-otp'),
    JSON.stringify({ phone }),
    { headers, timeout: '30s' }
  );

  if (otpRes.status !== 200) {
    errorCounter.add(1);
    successRate.add(false);
    return;
  }

  const otp = otpRes.json('test_mode_otp');
  if (!otp) {
    errorCounter.add(1);
    successRate.add(false);
    return;
  }

  const verifyRes = http.post(
    getUrl('/auth/verify-otp'),
    JSON.stringify({ phone, otp, name: `SSDUser_${__VU}`, medium: 'english' }),
    { headers, timeout: '30s' }
  );

  if (verifyRes.status !== 200) {
    errorCounter.add(1);
    successRate.add(false);
    return;
  }

  token = verifyRes.json('token');
  successRate.add(true);

  // === Quiz Flow ===
  const startRes = http.post(
    getUrl('/level/start'),
    JSON.stringify({ level: 1 }),
    { headers: authHeaders(token), timeout: '30s' }
  );

  if (startRes.status !== 200) {
    errorCounter.add(1);
    quizCompleteRate.add(false);
    return;
  }

  const attemptId = startRes.json('attempt_id');
  const questions = startRes.json('questions');

  if (!questions || questions.length === 0) {
    quizCompleteRate.add(false);
    return;
  }

  // Answer all questions
  let success = true;
  for (const q of questions) {
    const ansRes = http.post(
      getUrl('/question/answer'),
      JSON.stringify({
        attempt_id: attemptId,
        question_id: q.sl,
        user_answer: CORRECT_ANSWER
      }),
      { headers: authHeaders(token), timeout: '30s' }
    );

    if (ansRes.status !== 200) {
      success = false;
      errorCounter.add(1);
      break;
    }
  }

  quizCompleteRate.add(success);
  sleep(0.05);
}

export function handleSummary(data) {
  const m = data.metrics;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           SSD + 6 WORKERS STRESS TEST RESULTS                ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Requests:     ${String(m.http_reqs?.values?.count || 0).padStart(10)}                        ║`);
  console.log(`║  Total Errors:       ${String(m.errors?.values?.count || 0).padStart(10)}                        ║`);
  console.log(`║  Success Rate:       ${String(((m.success_rate?.values?.rate || 0) * 100).toFixed(2) + '%').padStart(10)}                        ║`);
  console.log(`║  Quiz Complete Rate: ${String(((m.quiz_complete_rate?.values?.rate || 0) * 100).toFixed(2) + '%').padStart(10)}                        ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Avg Response:       ${String((m.http_req_duration?.values?.avg || 0).toFixed(0) + 'ms').padStart(10)}                        ║`);
  console.log(`║  P95 Response:       ${String((m.http_req_duration?.values?.['p(95)'] || 0).toFixed(0) + 'ms').padStart(10)}                        ║`);
  console.log(`║  P99 Response:       ${String((m.http_req_duration?.values?.['p(99)'] || 0).toFixed(0) + 'ms').padStart(10)}                        ║`);
  console.log(`║  Max Response:       ${String((m.http_req_duration?.values?.max || 0).toFixed(0) + 'ms').padStart(10)}                        ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');

  return {
    'ssd-stress-test-results.json': JSON.stringify(data, null, 2),
  };
}
