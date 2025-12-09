// k6 Configuration for JNV Quiz App Stress Test
export const CONFIG = {
  BASE_URL: 'https://jnvquiz.tsblive.in',
  APP_SLUG: 'computer',

  // Test phone numbers (will be generated dynamically)
  PHONE_PREFIX: '99999',

  // Quiz settings - all answers are option 1
  CORRECT_ANSWER: 1,
  QUESTIONS_PER_LEVEL: 10,

  // Thresholds
  THRESHOLDS: {
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
    http_req_failed: ['rate<0.05'],     // Less than 5% errors
  }
};

export function getApiUrl(endpoint) {
  return `${CONFIG.BASE_URL}/api/v1/${CONFIG.APP_SLUG}${endpoint}`;
}

export function generatePhone(vuId) {
  // Generate unique phone per virtual user
  return CONFIG.PHONE_PREFIX + String(vuId).padStart(5, '0');
}
