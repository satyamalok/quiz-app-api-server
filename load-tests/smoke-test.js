import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const healthCheckDuration = new Trend('health_check_duration');
const sendOtpDuration = new Trend('send_otp_duration');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://quiz.tsblive.in';

export const options = {
  // Smoke test: 10 users for 30 seconds
  vus: 10,
  duration: '30s',

  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% requests under 2s
    http_req_failed: ['rate<0.5'],      // Less than 50% HTTP errors (401s are expected)
    errors: ['rate<0.1'],               // Custom error rate under 10%
  },
};

export default function () {
  // Test 1: Health Check (truly public endpoint)
  let healthRes = http.get(`${BASE_URL}/health`);
  healthCheckDuration.add(healthRes.timings.duration);

  let healthCheck = check(healthRes, {
    'health: status is 200': (r) => r.status === 200,
    'health: response time < 500ms': (r) => r.timings.duration < 500,
    'health: has valid response': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ok' || body.success === true;
      } catch (e) {
        return r.body.includes('ok') || r.status === 200;
      }
    },
  });
  errorRate.add(!healthCheck);

  sleep(0.5);

  // Test 2: Send OTP (public but rate-limited)
  // Use unique phone per VU+iteration to avoid conflicts
  const phone = `90${String(__VU).padStart(4, '0')}${String(__ITER % 10000).padStart(4, '0')}`;

  const otpPayload = JSON.stringify({ phone: phone });
  let otpRes = http.post(`${BASE_URL}/api/v1/auth/send-otp`, otpPayload, {
    headers: { 'Content-Type': 'application/json' },
  });
  sendOtpDuration.add(otpRes.timings.duration);

  let otpCheck = check(otpRes, {
    'send-otp: status is 200 or 429 (rate-limited)': (r) => r.status === 200 || r.status === 429,
    'send-otp: response time < 2000ms': (r) => r.timings.duration < 2000,
  });
  errorRate.add(!otpCheck);

  sleep(1.5);

  // Test 3: App Version (public endpoint)
  let versionRes = http.get(`${BASE_URL}/api/v1/app/version?platform=android&current_version=1.0.0`);

  let versionCheck = check(versionRes, {
    'app-version: responds': (r) => r.status === 200 || r.status === 401 || r.status === 404,
    'app-version: response time < 1000ms': (r) => r.timings.duration < 1000,
  });
  errorRate.add(!versionCheck);

  sleep(0.5);
}

export function handleSummary(data) {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   SMOKE TEST SUMMARY                          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  const metrics = data.metrics;

  console.log('║ Request Duration (ms):                                        ║');
  console.log(`║   Average: ${metrics.http_req_duration.values.avg.toFixed(2).padStart(10)}                                   ║`);
  console.log(`║   Min:     ${metrics.http_req_duration.values.min.toFixed(2).padStart(10)}                                   ║`);
  console.log(`║   Max:     ${metrics.http_req_duration.values.max.toFixed(2).padStart(10)}                                   ║`);
  console.log(`║   p(95):   ${metrics.http_req_duration.values['p(95)'].toFixed(2).padStart(10)}                                   ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ Request Stats:                                                ║');
  console.log(`║   Total Requests:  ${String(metrics.http_reqs.values.count).padStart(8)}                             ║`);
  console.log(`║   Requests/sec:    ${metrics.http_reqs.values.rate.toFixed(2).padStart(8)}                             ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');

  if (metrics.health_check_duration) {
    console.log(`║ Health Check (avg): ${metrics.health_check_duration.values.avg.toFixed(2).padStart(8)} ms                        ║`);
  }
  if (metrics.send_otp_duration) {
    console.log(`║ Send OTP (avg):     ${metrics.send_otp_duration.values.avg.toFixed(2).padStart(8)} ms                        ║`);
  }

  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Determine pass/fail
  const p95 = metrics.http_req_duration.values['p(95)'];
  const errRate = metrics.errors ? metrics.errors.values.rate : 0;

  if (p95 < 2000 && errRate < 0.1) {
    console.log('✅ SMOKE TEST PASSED - Server is responsive!\n');
  } else {
    console.log('⚠️  SMOKE TEST WARNING - Some issues detected\n');
    console.log(`   p95: ${p95.toFixed(2)}ms (threshold: 2000ms)`);
    console.log(`   Error rate: ${(errRate * 100).toFixed(2)}% (threshold: 10%)\n`);
  }

  return {};
}
