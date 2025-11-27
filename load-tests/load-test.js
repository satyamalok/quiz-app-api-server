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
const reelsFeedDuration = new Trend('reels_feed_duration');
const successfulLogins = new Counter('successful_logins');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://quiz.tsblive.in';
const API_URL = `${BASE_URL}/api/v1`;

// Get VUs and duration from environment or use defaults
const VUS = parseInt(__ENV.VUS) || 100;
const DURATION = __ENV.DURATION || '2m';

export const options = {
  // Configurable via environment variables
  vus: VUS,
  duration: DURATION,

  thresholds: {
    http_req_duration: ['p(95)<3000'],  // 95% requests under 3s
    http_req_failed: ['rate<0.1'],       // Less than 10% errors
    errors: ['rate<0.15'],               // Custom error rate under 15%
  },
};

// Generate unique phone number per VU
function getTestPhone() {
  // Use VU id + timestamp to create unique phones
  const vuId = __VU;
  const iteration = __ITER;
  return `90000${String(vuId).padStart(3, '0')}${String(iteration % 100).padStart(2, '0')}`;
}

// Store tokens per VU
let authToken = null;

export function setup() {
  // Verify server is reachable
  const healthRes = http.get(`${BASE_URL}/health`);
  if (healthRes.status !== 200) {
    console.error(`Server health check failed: ${healthRes.status}`);
  }
  console.log(`Starting load test against ${BASE_URL}`);
  console.log(`VUs: ${VUS}, Duration: ${DURATION}`);
  return { baseUrl: BASE_URL };
}

export default function (data) {
  const phone = getTestPhone();

  // ============ GROUP 1: Authentication Flow ============
  group('Authentication', function () {
    // Send OTP
    const otpPayload = JSON.stringify({ phone: phone });
    const otpRes = http.post(`${API_URL}/auth/send-otp`, otpPayload, {
      headers: { 'Content-Type': 'application/json' },
    });
    authDuration.add(otpRes.timings.duration);

    const otpCheck = check(otpRes, {
      'send-otp: status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    });

    if (otpRes.status === 429) {
      // Rate limited - skip this iteration
      errorRate.add(false); // Not an error, just rate limited
      sleep(2);
      return;
    }

    errorRate.add(!otpCheck);

    // Extract OTP from test mode response
    let otp = '123456'; // fallback
    if (otpRes.status === 200) {
      try {
        const otpBody = JSON.parse(otpRes.body);
        if (otpBody.test_mode_otp) {
          otp = otpBody.test_mode_otp;
        }
      } catch (e) {}
    }

    sleep(0.5);

    // Verify OTP (using test mode OTP from response)
    const verifyPayload = JSON.stringify({
      phone: phone,
      otp: otp,
      name: `LoadTest User ${__VU}`,
      medium: 'english',
    });

    const verifyRes = http.post(`${API_URL}/auth/verify-otp`, verifyPayload, {
      headers: { 'Content-Type': 'application/json' },
    });
    authDuration.add(verifyRes.timings.duration);

    const verifyCheck = check(verifyRes, {
      'verify-otp: status is 200 or 400': (r) => r.status === 200 || r.status === 400,
    });
    errorRate.add(!verifyCheck);

    if (verifyRes.status === 200) {
      try {
        const body = JSON.parse(verifyRes.body);
        if (body.success && body.data && body.data.token) {
          authToken = body.data.token;
          successfulLogins.add(1);
        }
      } catch (e) {
        console.error('Failed to parse verify response');
      }
    }
  });

  sleep(1);

  // Skip authenticated tests if no token
  if (!authToken) {
    return;
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };

  // ============ GROUP 2: Profile & Stats ============
  group('Profile', function () {
    const profileRes = http.get(`${API_URL}/user/profile`, {
      headers: authHeaders,
    });
    profileDuration.add(profileRes.timings.duration);

    const profileCheck = check(profileRes, {
      'profile: status is 200': (r) => r.status === 200,
      'profile: response time < 2000ms': (r) => r.timings.duration < 2000,
    });
    errorRate.add(!profileCheck);
  });

  sleep(0.5);

  // ============ GROUP 3: Leaderboard (Heavy Read) ============
  group('Leaderboard', function () {
    const leaderboardRes = http.get(`${API_URL}/leaderboard/daily`, {
      headers: authHeaders,
    });
    leaderboardDuration.add(leaderboardRes.timings.duration);

    const leaderboardCheck = check(leaderboardRes, {
      'leaderboard: status is 200': (r) => r.status === 200,
      'leaderboard: response time < 3000ms': (r) => r.timings.duration < 3000,
    });
    errorRate.add(!leaderboardCheck);
  });

  sleep(0.5);

  // ============ GROUP 4: Quiz Flow (Most Critical) ============
  group('Quiz Flow', function () {
    // Start Level 1
    const startPayload = JSON.stringify({ level: 1 });
    const startRes = http.post(`${API_URL}/level/start`, startPayload, {
      headers: authHeaders,
    });
    levelStartDuration.add(startRes.timings.duration);

    const startCheck = check(startRes, {
      'level-start: status is 200 or 400': (r) => r.status === 200 || r.status === 400,
      'level-start: response time < 3000ms': (r) => r.timings.duration < 3000,
    });
    errorRate.add(!startCheck);

    // If level started, answer a few questions
    if (startRes.status === 200) {
      try {
        const levelData = JSON.parse(startRes.body);
        if (levelData.success && levelData.data && levelData.data.attempt_id) {
          const attemptId = levelData.data.attempt_id;
          const questions = levelData.data.questions || [];

          // Answer first 3 questions (simulate partial quiz)
          for (let i = 0; i < Math.min(3, questions.length); i++) {
            sleep(0.3);

            const answerPayload = JSON.stringify({
              attempt_id: attemptId,
              question_order: i + 1,
              selected_option: 1, // Always select option 1
            });

            const answerRes = http.post(`${API_URL}/question/answer`, answerPayload, {
              headers: authHeaders,
            });
            answerDuration.add(answerRes.timings.duration);

            const answerCheck = check(answerRes, {
              'answer: status is 200': (r) => r.status === 200,
              'answer: response time < 2000ms': (r) => r.timings.duration < 2000,
            });
            errorRate.add(!answerCheck);
          }
        }
      } catch (e) {
        console.error('Failed to parse level start response');
      }
    }
  });

  sleep(0.5);

  // ============ GROUP 5: Reels Feed ============
  group('Reels', function () {
    const reelsRes = http.get(`${API_URL}/reels/feed`, {
      headers: authHeaders,
    });
    reelsFeedDuration.add(reelsRes.timings.duration);

    const reelsCheck = check(reelsRes, {
      'reels: status is 200': (r) => r.status === 200,
      'reels: response time < 2000ms': (r) => r.timings.duration < 2000,
    });
    errorRate.add(!reelsCheck);
  });

  sleep(1);
}

export function handleSummary(data) {
  const metrics = data.metrics;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    LOAD TEST RESULTS                          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ Overall Request Duration (ms):                                ║');
  console.log(`║   Average: ${metrics.http_req_duration.values.avg.toFixed(2).padStart(10)}                                     ║`);
  console.log(`║   Min:     ${metrics.http_req_duration.values.min.toFixed(2).padStart(10)}                                     ║`);
  console.log(`║   Max:     ${metrics.http_req_duration.values.max.toFixed(2).padStart(10)}                                     ║`);
  console.log(`║   p(95):   ${metrics.http_req_duration.values['p(95)'].toFixed(2).padStart(10)}                                     ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ Request Statistics:                                           ║');
  console.log(`║   Total Requests:  ${String(metrics.http_reqs.values.count).padStart(8)}                               ║`);
  console.log(`║   Failed Requests: ${String(metrics.http_req_failed.values.passes || 0).padStart(8)}                               ║`);
  console.log(`║   Requests/sec:    ${metrics.http_reqs.values.rate.toFixed(2).padStart(8)}                               ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');

  // Custom metrics
  if (metrics.auth_duration) {
    console.log(`║ Auth Duration (avg):        ${metrics.auth_duration.values.avg.toFixed(2).padStart(8)} ms                     ║`);
  }
  if (metrics.profile_duration) {
    console.log(`║ Profile Duration (avg):     ${metrics.profile_duration.values.avg.toFixed(2).padStart(8)} ms                     ║`);
  }
  if (metrics.level_start_duration) {
    console.log(`║ Level Start Duration (avg): ${metrics.level_start_duration.values.avg.toFixed(2).padStart(8)} ms                     ║`);
  }
  if (metrics.answer_duration) {
    console.log(`║ Answer Duration (avg):      ${metrics.answer_duration.values.avg.toFixed(2).padStart(8)} ms                     ║`);
  }
  if (metrics.leaderboard_duration) {
    console.log(`║ Leaderboard Duration (avg): ${metrics.leaderboard_duration.values.avg.toFixed(2).padStart(8)} ms                     ║`);
  }
  if (metrics.reels_feed_duration) {
    console.log(`║ Reels Feed Duration (avg):  ${metrics.reels_feed_duration.values.avg.toFixed(2).padStart(8)} ms                     ║`);
  }

  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');

  return {
    'load-tests/results/load-test-summary.json': JSON.stringify(data, null, 2),
  };
}
