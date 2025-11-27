module.exports = {
  apps: [{
    name: 'quiz-api',
    script: 'server.js',

    // Cluster mode with 4 workers (optimal for 6-core server)
    instances: 4,
    exec_mode: 'cluster',

    // Environment variables
    env: {
      NODE_ENV: 'development',
      PM2_INSTANCES: 4,
    },
    env_production: {
      NODE_ENV: 'production',
      PM2_INSTANCES: 4,
    },

    // Memory management - restart if worker exceeds 500MB
    max_memory_restart: '500M',

    // Logging
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,

    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,

    // Restart policy
    autorestart: true,
    watch: false,  // Disable file watching in production
    max_restarts: 10,
    restart_delay: 1000,
  }]
};
