import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// ============= POST-CACHE STRESS TEST =============
// Tests performance after Redis caching implementation
// Goal: Find breaking point and comfortable operating point
//
// Previous results (pre-cache):
// - PostgreSQL tuning: ~250-300 req/s
// - SSD + 6 workers: ~400-500 req/s
//
// Expected improvement with caching: 600-1000+ req/s

const BASE_URL = 'https://jnvquiz.tsblive.in';
const APP_SLUG = 'computer';
const PHONE_PREFIX = '99999'; // New prefix for this test
const CORRECT_ANSWER = 1;

// Custom metrics
const errorCounter = new Counter('errors');
const successRate = new Rate('success_rate');
const quizCompleteRate = new Rate('quiz_complete_rate');
const authDuration = new Trend('auth_duration');
const quizDuration = new Trend('quiz_duration');

export const options = {
  scenarios: {
    find_breaking_point: {
      executor: 'ramping-arrival-rate',
      startRate: 300,           // Start at previous comfortable point
      timeUnit: '1s',
      preAllocatedVUs: 1000,
      maxVUs: 2000,
      stages: [
        // Stage 1: Warm up at previous known good rate
        { duration: '30s', target: 300 },

        // Stage 2: Push to previous ceiling
        { duration: '30s', target: 500 },

        // Stage 3: New territory - test cache effectiveness
        { duration: '45s', target: 700 },

        // Stage 4: Push harder
        { duration: '45s', target: 900 },

        // Stage 5: Find the limit
        { duration: '45s', target: 1100 },

        // Stage 6: Extreme test
        { duration: '45s', target: 1300 },

        // Stage 7: Sustained at high load
        { duration: '60s', target: 1000 },

        // Stage 8: Cool down
        { duration: '30s', target: 500 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],  // 95th percentile under 3s
    http_req_failed: ['rate<0.15'],      // Less than 15% failure rate
    success_rate: ['rate>0.80'],         // 80% success rate
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
  const authStart = Date.now();

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
    JSON.stringify({ phone, otp, name: `CacheTest_${__VU}`, medium: 'english' }),
    { headers, timeout: '30s' }
  );

  if (verifyRes.status !== 200) {
    errorCounter.add(1);
    successRate.add(false);
    return;
  }

  token = verifyRes.json('token');
  authDuration.add(Date.now() - authStart);
  successRate.add(true);

  // === Quiz Flow (tests question caching) ===
  const quizStart = Date.now();

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

  quizDuration.add(Date.now() - quizStart);
  quizCompleteRate.add(success);

  // Small delay to simulate real user behavior
  sleep(0.02);
}

export function handleSummary(data) {
  const m = data.metrics;

  // Calculate rates at different stages based on timing
  const avgRate = m.http_reqs?.values?.rate || 0;
  const p95 = m.http_req_duration?.values?.['p(95)'] || 0;
  const errorRate = (m.http_req_failed?.values?.rate || 0) * 100;

  // Determine comfortable vs breaking point
  let assessment = '';
  if (errorRate < 5 && p95 < 1000) {
    assessment = 'EXCELLENT - System handling load well';
  } else if (errorRate < 10 && p95 < 2000) {
    assessment = 'GOOD - Near comfortable limit';
  } else if (errorRate < 15 && p95 < 3000) {
    assessment = 'WARNING - Approaching breaking point';
  } else {
    assessment = 'CRITICAL - At or past breaking point';
  }

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║         POST-CACHE STRESS TEST RESULTS                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Assessment: ${assessment.padEnd(51)}║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Requests:     ${String(m.http_reqs?.values?.count || 0).padStart(10)}                            ║`);
  console.log(`║  Avg Request Rate:   ${String(avgRate.toFixed(1) + '/s').padStart(10)}                            ║`);
  console.log(`║  Total Errors:       ${String(m.errors?.values?.count || 0).padStart(10)}                            ║`);
  console.log(`║  Error Rate:         ${String(errorRate.toFixed(2) + '%').padStart(10)}                            ║`);
  console.log(`║  Success Rate:       ${String(((m.success_rate?.values?.rate || 0) * 100).toFixed(2) + '%').padStart(10)}                            ║`);
  console.log(`║  Quiz Complete Rate: ${String(((m.quiz_complete_rate?.values?.rate || 0) * 100).toFixed(2) + '%').padStart(10)}                            ║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Avg Response:       ${String((m.http_req_duration?.values?.avg || 0).toFixed(0) + 'ms').padStart(10)}                            ║`);
  console.log(`║  P50 Response:       ${String((m.http_req_duration?.values?.['p(50)'] || 0).toFixed(0) + 'ms').padStart(10)}                            ║`);
  console.log(`║  P90 Response:       ${String((m.http_req_duration?.values?.['p(90)'] || 0).toFixed(0) + 'ms').padStart(10)}                            ║`);
  console.log(`║  P95 Response:       ${String((m.http_req_duration?.values?.['p(95)'] || 0).toFixed(0) + 'ms').padStart(10)}                            ║`);
  console.log(`║  P99 Response:       ${String((m.http_req_duration?.values?.['p(99)'] || 0).toFixed(0) + 'ms').padStart(10)}                            ║`);
  console.log(`║  Max Response:       ${String((m.http_req_duration?.values?.max || 0).toFixed(0) + 'ms').padStart(10)}                            ║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Avg Auth Duration:  ${String((m.auth_duration?.values?.avg || 0).toFixed(0) + 'ms').padStart(10)}                            ║`);
  console.log(`║  Avg Quiz Duration:  ${String((m.quiz_duration?.values?.avg || 0).toFixed(0) + 'ms').padStart(10)}                            ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  console.log('INTERPRETATION GUIDE:');
  console.log('─────────────────────');
  console.log('• Comfortable Point: Where P95 < 500ms and Error Rate < 2%');
  console.log('• Breaking Point: Where P95 > 2000ms or Error Rate > 10%');
  console.log('• Compare Auth vs Quiz duration to see cache effectiveness');
  console.log('  (Quiz should be faster due to cached questions)');
  console.log('\n');

  return {
    'cache-stress-test-results.json': JSON.stringify(data, null, 2),
  };
}
