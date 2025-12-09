import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ============= CONFIGURATION =============
const BASE_URL = 'https://jnvquiz.tsblive.in';
const APP_SLUG = 'computer';
const PHONE_PREFIX = '99999';
const CORRECT_ANSWER = 1;

// Custom metrics
const errorCounter = new Counter('errors');
const successRate = new Rate('success_rate');
const quizCompleteRate = new Rate('quiz_complete_rate');

// ============= BREAKING POINT TEST =============
// Continuously increases load until system breaks
export const options = {
  scenarios: {
    breaking_point: {
      executor: 'ramping-arrival-rate',
      startRate: 5,           // Start at 5 requests/sec
      timeUnit: '1s',
      preAllocatedVUs: 200,   // Pre-allocate VUs
      maxVUs: 500,            // Max VUs allowed
      stages: [
        { duration: '30s', target: 10 },   // 10 req/s
        { duration: '30s', target: 25 },   // 25 req/s
        { duration: '30s', target: 50 },   // 50 req/s
        { duration: '30s', target: 75 },   // 75 req/s
        { duration: '30s', target: 100 },  // 100 req/s
        { duration: '30s', target: 150 },  // 150 req/s
        { duration: '30s', target: 200 },  // 200 req/s
        { duration: '1m', target: 200 },   // Hold at 200
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<5000'], // 99% under 5s (lenient for breaking point)
    errors: ['count<1000'],             // Stop if too many errors
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
  let attemptId = null;

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
    JSON.stringify({ phone, otp, name: `User_${__VU}`, medium: 'english' }),
    { headers, timeout: '30s' }
  );

  if (verifyRes.status !== 200) {
    errorCounter.add(1);
    successRate.add(false);
    return;
  }

  token = verifyRes.json('token');
  successRate.add(true);

  // === Quick Quiz (Level 1 only) ===
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

  attemptId = startRes.json('attempt_id');
  const questions = startRes.json('questions');

  if (!questions || questions.length === 0) {
    quizCompleteRate.add(false);
    return;
  }

  // Answer all questions rapidly
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

  // Minimal sleep
  sleep(0.1);
}

export function handleSummary(data) {
  const metrics = data.metrics;

  console.log('\n========== BREAKING POINT RESULTS ==========');
  console.log(`Total Requests: ${metrics.http_reqs?.values?.count || 0}`);
  console.log(`Total Errors: ${metrics.errors?.values?.count || 0}`);
  console.log(`Success Rate: ${((metrics.success_rate?.values?.rate || 0) * 100).toFixed(2)}%`);
  console.log(`Quiz Complete Rate: ${((metrics.quiz_complete_rate?.values?.rate || 0) * 100).toFixed(2)}%`);
  console.log(`Avg Response: ${(metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms`);
  console.log(`P95 Response: ${(metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms`);
  console.log(`P99 Response: ${(metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms`);
  console.log(`Max Response: ${(metrics.http_req_duration?.values?.max || 0).toFixed(2)}ms`);
  console.log('=============================================\n');

  return {
    'breaking-point-results.json': JSON.stringify(data, null, 2),
  };
}
