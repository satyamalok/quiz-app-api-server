import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ============= CONFIGURATION =============
const BASE_URL = 'https://jnvquiz.tsblive.in';
const APP_SLUG = 'computer';
const PHONE_PREFIX = '99999';
const CORRECT_ANSWER = 1;

// Custom metrics
const authSuccessRate = new Rate('auth_success_rate');
const quizSuccessRate = new Rate('quiz_success_rate');
const otpDuration = new Trend('otp_duration');
const quizDuration = new Trend('quiz_complete_duration');

// ============= TEST OPTIONS =============
export const options = {
  scenarios: {
    // Scenario 1: Ramp up load test
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },   // Ramp to 10 users
        { duration: '1m', target: 50 },    // Ramp to 50 users
        { duration: '2m', target: 100 },   // Ramp to 100 users
        { duration: '1m', target: 100 },   // Hold at 100
        { duration: '30s', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% under 2s
    http_req_failed: ['rate<0.05'],      // <5% errors
    auth_success_rate: ['rate>0.95'],    // >95% auth success
    quiz_success_rate: ['rate>0.90'],    // >90% quiz success
  },
};

// ============= HELPERS =============
function getUrl(endpoint) {
  return `${BASE_URL}/api/v1/${APP_SLUG}${endpoint}`;
}

function generatePhone(vuId, iteration) {
  // Unique phone per VU + iteration combo
  const num = (vuId * 10000 + iteration) % 100000;
  return PHONE_PREFIX + String(num).padStart(5, '0');
}

const headers = {
  'Content-Type': 'application/json',
};

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// ============= MAIN TEST FLOW =============
export default function () {
  const phone = generatePhone(__VU, __ITER);
  let token = null;
  let attemptId = null;
  let questionIds = [];

  // === GROUP 1: Authentication ===
  group('Authentication', function () {
    const startAuth = Date.now();

    // Send OTP
    const otpRes = http.post(
      getUrl('/auth/send-otp'),
      JSON.stringify({ phone }),
      { headers }
    );

    check(otpRes, {
      'OTP sent successfully': (r) => r.status === 200 && r.json('success') === true,
    });

    if (otpRes.status !== 200) {
      authSuccessRate.add(false);
      console.log(`OTP failed for ${phone}: ${otpRes.body}`);
      return;
    }

    const otp = otpRes.json('test_mode_otp');
    if (!otp) {
      authSuccessRate.add(false);
      console.log(`No OTP in response for ${phone}`);
      return;
    }

    sleep(0.1); // Small delay between OTP send and verify

    // Verify OTP
    const verifyRes = http.post(
      getUrl('/auth/verify-otp'),
      JSON.stringify({
        phone,
        otp,
        name: `StressUser_${__VU}_${__ITER}`,
        medium: 'english'
      }),
      { headers }
    );

    const verifySuccess = check(verifyRes, {
      'OTP verified': (r) => r.status === 200 && r.json('success') === true,
      'Token received': (r) => r.json('token') !== undefined,
    });

    authSuccessRate.add(verifySuccess);
    otpDuration.add(Date.now() - startAuth);

    if (verifyRes.status === 200) {
      token = verifyRes.json('token');
    }
  });

  if (!token) {
    sleep(1);
    return; // Skip quiz if auth failed
  }

  sleep(0.2);

  // === GROUP 2: Quiz Flow ===
  group('Quiz Flow', function () {
    const startQuiz = Date.now();

    // Start Level 1
    const startRes = http.post(
      getUrl('/level/start'),
      JSON.stringify({ level: 1 }),
      { headers: authHeaders(token) }
    );

    const startSuccess = check(startRes, {
      'Level started': (r) => r.status === 200 && r.json('success') === true,
      'Questions received': (r) => r.json('questions') && r.json('questions').length === 10,
    });

    if (!startSuccess) {
      quizSuccessRate.add(false);
      console.log(`Level start failed for ${phone}: ${startRes.body}`);
      return;
    }

    attemptId = startRes.json('attempt_id');
    const questions = startRes.json('questions');
    questionIds = questions.map(q => q.sl);

    sleep(0.1);

    // Answer all 10 questions
    let allCorrect = true;
    for (let i = 0; i < questionIds.length; i++) {
      const answerRes = http.post(
        getUrl('/question/answer'),
        JSON.stringify({
          attempt_id: attemptId,
          question_id: questionIds[i],
          user_answer: CORRECT_ANSWER
        }),
        { headers: authHeaders(token) }
      );

      const answerSuccess = check(answerRes, {
        'Answer accepted': (r) => r.status === 200 && r.json('success') === true,
      });

      if (!answerSuccess) {
        allCorrect = false;
        console.log(`Answer failed Q${i + 1} for ${phone}: ${answerRes.body}`);
        break;
      }

      // Small delay between answers (simulates user reading)
      sleep(0.05);
    }

    quizSuccessRate.add(allCorrect);
    quizDuration.add(Date.now() - startQuiz);
  });

  sleep(0.2);

  // === GROUP 3: Read Operations ===
  group('Read Operations', function () {
    // Get Profile
    const profileRes = http.get(
      getUrl('/user/profile'),
      { headers: authHeaders(token) }
    );

    check(profileRes, {
      'Profile loaded': (r) => r.status === 200 && r.json('success') === true,
    });

    // Get Leaderboard
    const leaderRes = http.get(
      getUrl('/leaderboard/daily'),
      { headers: authHeaders(token) }
    );

    check(leaderRes, {
      'Leaderboard loaded': (r) => r.status === 200 && r.json('success') === true,
    });
  });

  // Random sleep between iterations (1-3 seconds)
  sleep(Math.random() * 2 + 1);
}

// ============= LIFECYCLE HOOKS =============
export function handleSummary(data) {
  console.log('\n========== STRESS TEST SUMMARY ==========');
  console.log(`Total Requests: ${data.metrics.http_reqs.values.count}`);
  console.log(`Failed Requests: ${data.metrics.http_req_failed.values.passes}`);
  console.log(`Avg Response Time: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms`);
  console.log(`P95 Response Time: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms`);
  console.log(`Auth Success Rate: ${(data.metrics.auth_success_rate.values.rate * 100).toFixed(2)}%`);
  console.log(`Quiz Success Rate: ${(data.metrics.quiz_success_rate.values.rate * 100).toFixed(2)}%`);
  console.log('==========================================\n');

  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'stress-test-results.json': JSON.stringify(data, null, 2),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
