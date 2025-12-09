import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// ============= FIND COMFORTABLE LIMIT TEST =============
// More gradual ramp to find exact comfortable operating point
// Based on previous test: breaking point appears around 700-900 req/s

const BASE_URL = 'https://jnvquiz.tsblive.in';
const APP_SLUG = 'computer';
const PHONE_PREFIX = '88888';
const CORRECT_ANSWER = 1;

const errorCounter = new Counter('errors');
const successRate = new Rate('success_rate');
const quizCompleteRate = new Rate('quiz_complete_rate');

export const options = {
  scenarios: {
    find_limit: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 600,
      maxVUs: 1000,
      stages: [
        // Gradual ramp to find comfortable limit
        { duration: '20s', target: 200 },   // Warm up
        { duration: '30s', target: 300 },   // Known stable
        { duration: '30s', target: 400 },   // Previous limit area
        { duration: '30s', target: 500 },   // Test higher
        { duration: '40s', target: 600 },   // Push a bit more
        { duration: '40s', target: 700 },   // Near breaking point
        { duration: '30s', target: 500 },   // Cool down to sustainable
        { duration: '60s', target: 500 },   // Hold at sustainable
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
    JSON.stringify({ phone, otp, name: `LimitTest_${__VU}`, medium: 'english' }),
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
  const errorRate = (m.http_req_failed?.values?.rate || 0) * 100;
  const p95 = m.http_req_duration?.values?.['p(95)'] || 0;

  let status = 'UNKNOWN';
  if (errorRate < 2 && p95 < 500) {
    status = 'EXCELLENT';
  } else if (errorRate < 5 && p95 < 1000) {
    status = 'GOOD';
  } else if (errorRate < 10 && p95 < 2000) {
    status = 'ACCEPTABLE';
  } else {
    status = 'NEEDS OPTIMIZATION';
  }

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           FIND COMFORTABLE LIMIT - RESULTS                    ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Status: ${status.padEnd(53)}║`);
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Requests:     ${String(m.http_reqs?.values?.count || 0).padStart(10)}                       ║`);
  console.log(`║  Avg Rate:           ${String((m.http_reqs?.values?.rate || 0).toFixed(1) + '/s').padStart(10)}                       ║`);
  console.log(`║  Error Rate:         ${String(errorRate.toFixed(2) + '%').padStart(10)}                       ║`);
  console.log(`║  Success Rate:       ${String(((m.success_rate?.values?.rate || 0) * 100).toFixed(2) + '%').padStart(10)}                       ║`);
  console.log(`║  Quiz Complete:      ${String(((m.quiz_complete_rate?.values?.rate || 0) * 100).toFixed(2) + '%').padStart(10)}                       ║`);
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Avg Response:       ${String((m.http_req_duration?.values?.avg || 0).toFixed(0) + 'ms').padStart(10)}                       ║`);
  console.log(`║  P50 Response:       ${String((m.http_req_duration?.values?.['p(50)'] || 0).toFixed(0) + 'ms').padStart(10)}                       ║`);
  console.log(`║  P95 Response:       ${String(p95.toFixed(0) + 'ms').padStart(10)}                       ║`);
  console.log(`║  P99 Response:       ${String((m.http_req_duration?.values?.['p(99)'] || 0).toFixed(0) + 'ms').padStart(10)}                       ║`);
  console.log(`║  Max Response:       ${String((m.http_req_duration?.values?.max || 0).toFixed(0) + 'ms').padStart(10)}                       ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('\n');
  console.log('RECOMMENDATION:');
  console.log('───────────────');
  if (errorRate < 5 && p95 < 1000) {
    console.log(`• Comfortable Point: ~${Math.floor((m.http_reqs?.values?.rate || 0) * 0.8)} req/s`);
    console.log(`• Max Tested Rate: ~${Math.floor(m.http_reqs?.values?.rate || 0)} req/s`);
  } else {
    console.log('• Consider running test with lower rates to find stable point');
  }
  console.log('\n');

  return {
    'find-limit-results.json': JSON.stringify(data, null, 2),
  };
}
