# JNV Quiz App - Stress Tests

k6 stress test scripts for finding the breaking point of the quiz app API.

## Prerequisites

Install k6:
```bash
# Windows (chocolatey)
choco install k6

# Windows (winget)
winget install k6 --source winget

# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Test Scripts

### 1. Quick Test (Validation)
Quick 30-second test with 10 users to verify setup:
```bash
k6 run quick-test.js
```

### 2. Full Stress Test
Ramps from 10 → 50 → 100 users over ~5 minutes:
```bash
k6 run stress-test.js
```

### 3. Breaking Point Test
Continuously increases load (5 → 200 req/s) to find breaking point:
```bash
k6 run breaking-point.js
```

### 4. Read-Heavy Test
Tests read operations (profile, leaderboard) with up to 500 concurrent users:
```bash
k6 run read-heavy.js
```

## Configuration

All scripts target:
- **Base URL:** `https://jnvquiz.tsblive.in`
- **App:** `computer` (`/api/v1/computer/...`)
- **Quiz:** Level 1, 10 questions, all answers = option 1

To change target, edit the `BASE_URL` and `APP_SLUG` constants in each script.

## Expected Metrics

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| P95 Response | <500ms | 500-2000ms | >2000ms |
| Error Rate | <1% | 1-5% | >5% |
| Success Rate | >95% | 90-95% | <90% |

## Test Results

Results are saved as JSON files:
- `stress-test-results.json`
- `breaking-point-results.json`
- `read-heavy-results.json`

## Server Monitoring (During Test)

On the VPS, monitor:
```bash
# Database connections
psql -U admin -d quizdb -c "SELECT count(*), state FROM pg_stat_activity WHERE datname='quizdb' GROUP BY state;"

# CPU/Memory
htop

# Node.js process
pm2 monit

# Redis
redis-cli info stats | grep instantaneous_ops_per_sec
```

## Interpreting Results

### Breaking Point Indicators
1. **Response time spike** - P95 jumps from <500ms to >2000ms
2. **Error rate spike** - Goes from <1% to >5%
3. **Connection timeouts** - "connection refused" or timeout errors
4. **Database exhaustion** - 50/50 connections used

### Common Bottlenecks
1. **DB Connection Pool** (50 max) - Increase to 100 if exhausted
2. **Single Node.js Process** - Consider PM2 cluster mode
3. **Redis** - Check if caching is working (should reduce DB load)
