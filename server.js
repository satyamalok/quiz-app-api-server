const app = require('./src/app');
const { startAutoUpdateJob } = require('./src/services/onlineUsersService');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Start server
const server = app.listen(PORT, () => {
  console.log('\n==============================================');
  console.log('  JNV QUIZ APP - API SERVER');
  console.log('==============================================\n');
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✓ API Base URL: http://localhost:${PORT}/api/v1`);
  console.log(`✓ Admin Panel: http://localhost:${PORT}/admin`);
  console.log('\n==============================================\n');

  // Start background jobs
  console.log('Starting background jobs...\n');
  startAutoUpdateJob();
  console.log('\n==============================================\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
