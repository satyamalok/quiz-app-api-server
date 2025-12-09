import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// ============= STABLE POINT TEST =============
// Conservative test to find exact stable operating point
// Based on previous tests: issues appear around 400-500 req/s
// This test focuses on lower rates to find where stability begins

const BASE_URL = 'https://jnvquiz.tsblive.in';
const APP_SLUG = 'computer';
const PHONE_PREFIX = '77777';
const CORRECT_ANSWER = 1;

const errorCounter = new Counter('errors');
const successRate = new Rate('success_rate');
const quizCompleteRate = new Rate('quiz_complete_rate');

export const options = {
  scenarios: {
    stable_test: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 500,
      stages: [
        // Gradual ramp to find stable point
        { duration: '20s', target: 100 },   // Warm up
        { duration: '30s', target: 150 },   // Very conservative
        { duration: '30s', target: 200 },   // Still conservative
        { duration: '40s', target: 250 },   // Test a bit higher
        { duration: '40s', target: 300 },   // Previous known limit
        { duration: '40s', target: 350 },   // Just above limit
        { duration: '60s', target: 300 },   // Hold at suspected stable
        { duration: '30s', target: 200 },   // Cool down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.05'],
    success_rate: ['rate>0.90'],
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
    JSON.stringify({ phone, otp, name: `StableTest_${__VU}`, medium: 'english' }),
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
  const avgRate = m.http_reqs?.values?.rate || 0;

  let status = 'UNKNOWN';
  if (errorRate < 1 && p95 < 300) {
    status = 'EXCELLENT - Very stable';
  } else if (errorRate < 2 && p95 < 500) {
    status = 'GOOD - Stable';
  } else if (errorRate < 5 && p95 < 1000) {
    status = 'ACCEPTABLE - Near limit';
  } else {
    status = 'UNSTABLE - Above capacity';
  }

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              STABLE POINT TEST - RESULTS                      ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Status: ${status.padEnd(53)}║`);
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Requests:     ${String(m.http_reqs?.values?.count || 0).padStart(10)}                       ║`);
  console.log(`║  Avg Rate:           ${String(avgRate.toFixed(1) + '/s').padStart(10)}                       ║`);
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
  console.log('RECOMMENDATIONS:');
  console.log('─────────────────');
  if (errorRate < 2 && p95 < 500) {
    console.log(`✓ Comfortable Operating Point: ~${Math.floor(avgRate * 0.8)} req/s`);
    console.log(`✓ Max Sustainable Rate: ~${Math.floor(avgRate)} req/s`);
    console.log('✓ System is stable at tested rates');
  } else if (errorRate < 5 && p95 < 1000) {
    console.log(`⚠ Operating near capacity limit`);
    console.log(`⚠ Recommended: Stay below ${Math.floor(avgRate * 0.7)} req/s`);
  } else {
    console.log('✗ System is above capacity at tested rates');
    console.log('✗ Consider lower load or infrastructure scaling');
  }
  console.log('\n');

  return {
    'stable-point-results.json': JSON.stringify(data, null, 2),
  };
}
