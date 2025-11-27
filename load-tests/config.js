// Load Test Configuration
export const CONFIG = {
  BASE_URL: 'https://quiz.tsblive.in/api/v1',

  // Test scenarios
  SCENARIOS: {
    SMOKE: { vus: 10, duration: '30s' },
    LOAD: { vus: 100, duration: '2m' },
    LOAD_MEDIUM: { vus: 500, duration: '3m' },
    STRESS: { vus: 1000, duration: '5m' },
  },

  // Thresholds (pass/fail criteria)
  THRESHOLDS: {
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
    http_req_failed: ['rate<0.05'],     // Error rate under 5%
  },

  // Test phone numbers (will be generated dynamically)
  // Format: 9000000001, 9000000002, etc.
  TEST_PHONE_PREFIX: '900000',
};

// Generate test phone number based on VU id
export function getTestPhone(vuId) {
  return CONFIG.TEST_PHONE_PREFIX + String(vuId).padStart(4, '0');
}
