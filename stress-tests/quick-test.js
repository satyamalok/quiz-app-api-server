import http from 'k6/http';
import { check, sleep } from 'k6';

// ============= QUICK VALIDATION TEST =============
// 10 users, 30 seconds - just to verify setup works

const BASE_URL = 'https://jnvquiz.tsblive.in';
const APP_SLUG = 'computer';
const CORRECT_ANSWER = 1;

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.1'],
  },
};

function getUrl(endpoint) {
  return `${BASE_URL}/api/v1/${APP_SLUG}${endpoint}`;
}

const headers = { 'Content-Type': 'application/json' };

export default function () {
  const phone = '77777' + String(__VU).padStart(5, '0');

  // Send OTP
  const otpRes = http.post(
    getUrl('/auth/send-otp'),
    JSON.stringify({ phone }),
    { headers }
  );

  check(otpRes, { 'OTP sent': (r) => r.status === 200 });
  if (otpRes.status !== 200) return;

  const otp = otpRes.json('test_mode_otp');

  // Verify OTP
  const verifyRes = http.post(
    getUrl('/auth/verify-otp'),
    JSON.stringify({ phone, otp, name: `Quick_${__VU}`, medium: 'english' }),
    { headers }
  );

  check(verifyRes, { 'Auth success': (r) => r.status === 200 });
  if (verifyRes.status !== 200) return;

  const token = verifyRes.json('token');
  const authHeaders = { ...headers, 'Authorization': `Bearer ${token}` };

  // Start level
  const startRes = http.post(
    getUrl('/level/start'),
    JSON.stringify({ level: 1 }),
    { headers: authHeaders }
  );

  check(startRes, { 'Level started': (r) => r.status === 200 });
  if (startRes.status !== 200) return;

  const attemptId = startRes.json('attempt_id');
  const questions = startRes.json('questions');

  // Answer all questions
  for (const q of questions) {
    const ansRes = http.post(
      getUrl('/question/answer'),
      JSON.stringify({
        attempt_id: attemptId,
        question_id: q.sl,
        user_answer: CORRECT_ANSWER
      }),
      { headers: authHeaders }
    );

    check(ansRes, { 'Answer accepted': (r) => r.status === 200 });
  }

  // Get profile
  const profileRes = http.get(getUrl('/user/profile'), { headers: authHeaders });
  check(profileRes, { 'Profile loaded': (r) => r.status === 200 });

  sleep(1);
}
