/**
 * Timezone utilities for IST (Indian Standard Time)
 * IST is UTC+5:30
 */

const IST_OFFSET_HOURS = 5;
const IST_OFFSET_MINUTES = 30;

/**
 * Get current timestamp in IST
 * @returns {Date} Current date/time in IST
 */
function getISTTimestamp() {
  const now = new Date();
  // Convert to IST by adding 5 hours 30 minutes
  const istTime = new Date(now.getTime() + (IST_OFFSET_HOURS * 60 + IST_OFFSET_MINUTES) * 60 * 1000);
  return istTime;
}

/**
 * Get current date in IST as YYYY-MM-DD string
 * @returns {string} Current date in IST (YYYY-MM-DD format)
 */
function getISTDate() {
  const ist = getISTTimestamp();
  return ist.toISOString().split('T')[0];
}

/**
 * Get current time in IST as HH:MM:SS string
 * @returns {string} Current time in IST (HH:MM:SS format)
 */
function getISTTime() {
  const ist = getISTTimestamp();
  return ist.toISOString().split('T')[1].split('.')[0];
}

/**
 * Get current timestamp in IST as ISO string (for database storage)
 * @returns {string} Current timestamp in IST (ISO format without timezone)
 */
function getISTTimestampString() {
  const ist = getISTTimestamp();
  // Return in format suitable for PostgreSQL TIMESTAMP (without timezone)
  return ist.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Convert UTC date to IST
 * @param {Date|string} utcDate - Date in UTC
 * @returns {Date} Date in IST
 */
function utcToIST(utcDate) {
  const date = new Date(utcDate);
  return new Date(date.getTime() + (IST_OFFSET_HOURS * 60 + IST_OFFSET_MINUTES) * 60 * 1000);
}

/**
 * Format date for display in IST
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string in IST
 */
function formatISTDate(date) {
  const ist = utcToIST(date);
  return ist.toISOString().split('T')[0];
}

/**
 * Format time for display in IST
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted time string in IST (HH:MM:SS)
 */
function formatISTTime(date) {
  const ist = utcToIST(date);
  return ist.toISOString().split('T')[1].split('.')[0];
}

/**
 * SQL snippet to get current IST timestamp in PostgreSQL
 * Use this in SQL queries: ${SQL_IST_NOW}
 */
const SQL_IST_NOW = "NOW() AT TIME ZONE 'Asia/Kolkata'";

/**
 * SQL snippet to get current IST date in PostgreSQL
 * Use this in SQL queries: ${SQL_IST_DATE}
 */
const SQL_IST_DATE = "(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE";

/**
 * SQL snippet to get current IST time in PostgreSQL
 * Use this in SQL queries: ${SQL_IST_TIME}
 */
const SQL_IST_TIME = "(NOW() AT TIME ZONE 'Asia/Kolkata')::TIME";

module.exports = {
  getISTTimestamp,
  getISTDate,
  getISTTime,
  getISTTimestampString,
  utcToIST,
  formatISTDate,
  formatISTTime,
  SQL_IST_NOW,
  SQL_IST_DATE,
  SQL_IST_TIME
};
