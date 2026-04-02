module.exports = {
  apps: [
    {
      name:        'checkton-backend',
      script:      './apps/backend/dist/index.js',
      cwd:         './apps/backend',
      instances:   1,
      exec_mode:   'fork',
      watch:       false,
      env: {
        NODE_ENV: 'production',
        PORT:     3001,
      },
      error_file:  './logs/pm2-error.log',
      out_file:    './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts:  10,
    },
  ],
};
