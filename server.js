const app = require('./src/app');
const { startAutoUpdateJob } = require('./src/services/onlineUsersService');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Start server
const server = app.listen(PORT, () => {
  const workerId = process.env.NODE_APP_INSTANCE || 'main';
  
  console.log('\n==============================================');
  console.log('  JNV QUIZ APP - API SERVER');
  console.log('==============================================\n');
  console.log('✓ Server running on port ' + PORT);
  console.log('✓ Worker: ' + workerId);
  console.log('✓ Environment: ' + (process.env.NODE_ENV || 'development'));
  console.log('✓ API Base URL: http://localhost:' + PORT + '/api/v1');
  console.log('✓ Admin Panel: http://localhost:' + PORT + '/admin');
  console.log('\n==============================================\n');

  // Start background jobs only on primary worker (worker 0)
  // PM2 sets NODE_APP_INSTANCE for each worker (0, 1, 2, 3...)
  const isPrimaryWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
  
  if (isPrimaryWorker) {
    console.log('Starting background jobs (primary worker)...\n');
    startAutoUpdateJob();
  } else {
    console.log('Skipping background jobs (handled by primary worker)\n');
  }
  
  console.log('==============================================\n');
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
