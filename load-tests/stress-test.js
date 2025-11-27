import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const authDuration = new Trend('auth_duration');
const profileDuration = new Trend('profile_duration');
const levelStartDuration = new Trend('level_start_duration');
const answerDuration = new Trend('answer_duration');
const leaderboardDuration = new Trend('leaderboard_duration');
const onlineCountDuration = new Trend('online_count_duration');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://quiz.tsblive.in';
const API_URL = `${BASE_URL}/api/v1`;

// Target VUs from environment (default 1000)
const TARGET_VUS = parseInt(__ENV.TARGET_VUS) || 1000;

export const options = {
  // Ramping stages - gradually increase load
  stages: [
    { duration: '30s', target: 100 },    // Ramp up to 100 users
    { duration: '1m', target: 100 },      // Stay at 100
    { duration: '30s', target: 500 },    // Ramp up to 500 users
    { duration: '2m', target: 500 },      // Stay at 500
    { duration: '30s', target: TARGET_VUS }, // Ramp up to target (1000)
    { duration: '3m', target: TARGET_VUS },  // Stay at target
    { duration: '1m', target: 0 },        // Ramp down
  ],

  thresholds: {
    http_req_duration: ['p(95)<5000'],   // 95% requests under 5s (relaxed for stress)
    http_req_failed: ['rate<0.2'],        // Less than 20% errors
    errors: ['rate<0.25'],                // Custom error rate under 25%
  },
};

// Store token per VU
let authToken = null;

function getTestPhone() {
  return `90000${String(__VU).padStart(3, '0')}${String(__ITER % 100).padStart(2, '0')}`;
}

export function setup() {
  const healthRes = http.get(`${BASE_URL}/health`);
  console.log(`\n🚀 Starting STRESS TEST against ${BASE_URL}`);
  console.log(`📊 Target: ${TARGET_VUS} concurrent users`);
  console.log(`⏱️  Stages: 100 → 500 → ${TARGET_VUS} users\n`);
  return {};
}

export default function () {
  const phone = getTestPhone();

  // ============ Unauthenticated endpoints (always test) ============
  group('Public Endpoints', function () {
    // Health check
    const healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, {
      'health: status 200': (r) => r.status === 200,
    });

    sleep(0.2);

    // Online count
    const onlineRes = http.get(`${API_URL}/app/online-count`);
    onlineCountDuration.add(onlineRes.timings.duration);
    check(onlineRes, {
      'online-count: status 200': (r) => r.status === 200,
    });
  });

  sleep(0.3);

  // ============ Auth Flow (creates load on DB) ============
  group('Auth Flow', function () {
    const otpPayload = JSON.stringify({ phone: phone });
    const otpRes = http.post(`${API_URL}/auth/send-otp`, otpPayload, {
      headers: { 'Content-Type': 'application/json' },
    });
    authDuration.add(otpRes.timings.duration);

    const otpOk = check(otpRes, {
      'send-otp: accepted': (r) => r.status === 200 || r.status === 429,
    });
    errorRate.add(!otpOk);

    if (otpRes.status === 429) {
      sleep(1);
      return;
    }

    // Extract OTP from test mode response
    let otp = '123456';
    if (otpRes.status === 200) {
      try {
        const otpBody = JSON.parse(otpRes.body);
        if (otpBody.test_mode_otp) {
          otp = otpBody.test_mode_otp;
        }
      } catch (e) {}
    }

    sleep(0.3);

    // Verify OTP (using test mode OTP)
    const verifyPayload = JSON.stringify({
      phone: phone,
      otp: otp,
      name: `StressTest ${__VU}`,
      medium: 'english',
    });

    const verifyRes = http.post(`${API_URL}/auth/verify-otp`, verifyPayload, {
      headers: { 'Content-Type': 'application/json' },
    });
    authDuration.add(verifyRes.timings.duration);

    if (verifyRes.status === 200) {
      try {
        const body = JSON.parse(verifyRes.body);
        if (body.success && body.data && body.data.token) {
          authToken = body.data.token;
        }
      } catch (e) {}
    }
  });

  // Skip authenticated tests if no token
  if (!authToken) {
    sleep(1);
    return;
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };

  // ============ Authenticated Endpoints ============
  group('Authenticated Endpoints', function () {
    // Profile
    const profileRes = http.get(`${API_URL}/user/profile`, { headers: authHeaders });
    profileDuration.add(profileRes.timings.duration);
    const profileOk = check(profileRes, {
      'profile: status 200': (r) => r.status === 200,
    });
    errorRate.add(!profileOk);

    sleep(0.2);

    // Leaderboard
    const leaderboardRes = http.get(`${API_URL}/leaderboard/daily`, { headers: authHeaders });
    leaderboardDuration.add(leaderboardRes.timings.duration);
    const lbOk = check(leaderboardRes, {
      'leaderboard: status 200': (r) => r.status === 200,
    });
    errorRate.add(!lbOk);

    sleep(0.2);

    // Start Level
    const startPayload = JSON.stringify({ level: 1 });
    const startRes = http.post(`${API_URL}/level/start`, startPayload, { headers: authHeaders });
    levelStartDuration.add(startRes.timings.duration);
    const startOk = check(startRes, {
      'level-start: accepted': (r) => r.status === 200 || r.status === 400,
    });
    errorRate.add(!startOk);

    // Answer 2 questions if level started
    if (startRes.status === 200) {
      try {
        const data = JSON.parse(startRes.body);
        if (data.success && data.data && data.data.attempt_id) {
          for (let i = 1; i <= 2; i++) {
            sleep(0.2);
            const answerPayload = JSON.stringify({
              attempt_id: data.data.attempt_id,
              question_order: i,
              selected_option: 1,
            });
            const answerRes = http.post(`${API_URL}/question/answer`, answerPayload, { headers: authHeaders });
            answerDuration.add(answerRes.timings.duration);
            const ansOk = check(answerRes, {
              'answer: status 200': (r) => r.status === 200,
            });
            errorRate.add(!ansOk);
          }
        }
      } catch (e) {}
    }
  });

  sleep(0.5);
}

export function handleSummary(data) {
  const m = data.metrics;

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                      STRESS TEST RESULTS                           ║');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Requests:      ${String(m.http_reqs.values.count).padStart(10)}                             ║`);
  console.log(`║  Failed Requests:     ${String(m.http_req_failed.values.passes || 0).padStart(10)}                             ║`);
  console.log(`║  Requests/sec:        ${m.http_reqs.values.rate.toFixed(2).padStart(10)}                             ║`);
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log('║  Response Time (ms):                                               ║');
  console.log(`║    Average:           ${m.http_req_duration.values.avg.toFixed(2).padStart(10)}                             ║`);
  console.log(`║    p(95):             ${m.http_req_duration.values['p(95)'].toFixed(2).padStart(10)}                             ║`);
  console.log(`║    p(99):             ${m.http_req_duration.values['p(99)'].toFixed(2).padStart(10)}                             ║`);
  console.log(`║    Max:               ${m.http_req_duration.values.max.toFixed(2).padStart(10)}                             ║`);
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log('║  Endpoint Breakdown (avg ms):                                      ║');

  if (m.auth_duration) {
    console.log(`║    Auth:              ${m.auth_duration.values.avg.toFixed(2).padStart(10)}                             ║`);
  }
  if (m.profile_duration) {
    console.log(`║    Profile:           ${m.profile_duration.values.avg.toFixed(2).padStart(10)}                             ║`);
  }
  if (m.leaderboard_duration) {
    console.log(`║    Leaderboard:       ${m.leaderboard_duration.values.avg.toFixed(2).padStart(10)}                             ║`);
  }
  if (m.level_start_duration) {
    console.log(`║    Level Start:       ${m.level_start_duration.values.avg.toFixed(2).padStart(10)}                             ║`);
  }
  if (m.answer_duration) {
    console.log(`║    Answer:            ${m.answer_duration.values.avg.toFixed(2).padStart(10)}                             ║`);
  }
  if (m.online_count_duration) {
    console.log(`║    Online Count:      ${m.online_count_duration.values.avg.toFixed(2).padStart(10)}                             ║`);
  }

  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Check if thresholds passed
  const passed = !data.root_group.checks ||
    Object.values(data.root_group.checks).every(c => c.passes / (c.passes + c.fails) > 0.8);

  if (passed) {
    console.log('✅ STRESS TEST PASSED - Server handled the load!');
  } else {
    console.log('❌ STRESS TEST FAILED - Server struggled under load');
  }

  return {
    'load-tests/results/stress-test-summary.json': JSON.stringify(data, null, 2),
  };
}
