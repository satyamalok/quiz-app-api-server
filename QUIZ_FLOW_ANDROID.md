# Quiz App - Android Implementation Flow

**Base URL**: `https://quiz.tsblive.in/api/v1`

**Authentication**: All protected endpoints require `Authorization: Bearer <jwt_token>` header.

---

## 1. Authentication Flow

### Step 1: Send OTP
```
POST /auth/send-otp
Body: { "phone": "9999999999" }
```
- Response includes `test_mode_otp` (for testing) and `otp_expires_in` (300 seconds)
- Store `phone` for next step

### Step 2: Verify OTP
```
POST /auth/verify-otp
Body: { "phone": "9999999999", "otp": "123456", "referral_code": "12345" (optional) }
```
- Response includes `token` (JWT - valid for 6 months)
- Store this token in secure storage (SharedPreferences/Keystore)
- `is_new_user` indicates if profile needs completion
- `user` object includes `current_level` (user can play levels 1 to current_level)

### Step 3: Validate Token (On App Start)
```
POST /auth/validate-token
Headers: Authorization: Bearer <token>
Body: {}
```
- Call this on every app launch to refresh streak and validate token
- If token expired, redirect to login

---

## 2. Level/Quiz Flow

### Step 1: Check User's Current Level
```
GET /user/profile
```
- Returns `current_level` (e.g., 5 means user can play levels 1-5)
- Show levels 1 to `current_level` as unlocked in UI
- Levels beyond `current_level` should show as locked

### Step 2: Start a Level
```
POST /level/start
Body: { "level": 1 }
```
**Response includes:**
- `attempt_id` - **CRITICAL**: Store this for all subsequent question answers
- `is_first_attempt` (true/false)
- `xp_per_correct` (5 for first attempt, 1 for replay)
- `lifelines_remaining` (initial: 3)
- `questions` array (10 questions with options)

**Important**:
- Options include `@` symbol prefix for correct answer (e.g., `"@New Delhi"`)
- Parse and identify correct answer client-side for answer validation
- DO NOT show `@` symbol in UI, use it only for internal tracking

### Step 3: Answer Questions (Loop for 10 questions)
```
POST /question/answer
Body: {
  "attempt_id": 123,
  "question_id": 1,
  "user_answer": 1  // 1-4 (option index)
}
```
**Response includes:**
- `is_correct` (true/false)
- `correct_answer` (1-4)
- `explanation_text` and `explanation_url` (show after answer)
- `progress.questions_attempted`, `progress.correct_answers`, `progress.accuracy_so_far`
- `lifelines.remaining` (decreases by 1 on wrong answer)
- `lifelines.can_watch_video_to_restore` (true when lifelines = 0)

**UI Flow:**
1. User selects answer → Call API
2. Show if correct/wrong with explanation
3. Update lifelines UI if wrong
4. If `lifelines.remaining` = 0 and `can_watch_video_to_restore` = true:
   - Show "Watch video to restore lifelines" button
   - User can continue answering (don't block)
5. Move to next question

### Step 4: Lifeline Restoration (Optional - if needed)
```
POST /video/restore-lifelines
Body: {
  "attempt_id": 123,
  "video_id": 1,  // Get from /video/url?level=N API
  "watch_duration_seconds": 45
}
```
**When to call:**
- Only when `lifelines.remaining` = 0
- After user watches ≥80% of lifeline video

**Watch Duration Tracking:**
```kotlin
// Start video
val startTime = System.currentTimeMillis()

// On video completion/user exits
val endTime = System.currentTimeMillis()
val watchDurationSeconds = (endTime - startTime) / 1000

// Send to server
val videoId = 1  // From /video/url API
restoreLifelines(attemptId, videoId, watchDurationSeconds)
```

**Response:**
- `lifelines_restored` (3)
- `lifelines_remaining` (3) - all restored

---

## 3. Video & XP Flow

### Step 1: Get Promotional Video
```
GET /video/url?level=1&category=promotional
```
- Call this after user completes all 10 questions
- Returns `video.id`, `video.video_url`, `video.duration_seconds`
- Show "Watch video to double XP" prompt

### Step 2: Track Video Watch Time
```kotlin
// Promotional video tracking
var videoStartTime = System.currentTimeMillis()

// User watches video (use ExoPlayer/MediaPlayer)
videoPlayer.addListener(object : Player.Listener {
    override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_ENDED || userExitsVideo) {
            val watchDuration = (System.currentTimeMillis() - videoStartTime) / 1000
            completeVideo(attemptId, videoId, watchDuration)
        }
    }
})
```

**Important**:
- Track actual watch time, not video duration
- Server validates ≥80% watch required (e.g., 53 sec video needs ≥43 sec watch)
- If user skips/exits early, send actual watched time (will fail validation)

### Step 3: Complete Video & Get XP
```
POST /video/complete
Body: {
  "attempt_id": 123,
  "video_id": 1,
  "watch_duration_seconds": 45
}
```
**Response includes:**
- `xp_details.base_xp` (e.g., 35 = 7 correct × 5 XP)
- `xp_details.bonus_xp` (equals base_xp)
- `xp_details.final_xp` (base + bonus = doubled)
- `user_progress.new_total_xp` (cumulative XP)
- `user_progress.level_unlocked` (true/false)
- `user_progress.new_current_level` (if unlocked, e.g., 2)

**UI Actions:**
1. Show XP animation (base → doubled)
2. Update user's total XP in UI
3. If `level_unlocked` = true:
   - Show "Level {new_current_level} Unlocked!" animation
   - Update level selection UI (unlock next level)

---

## 4. XP Calculation Logic

### First Attempt
- **XP per correct answer**: 5 XP
- Example: 8 correct → 40 base XP → 80 final XP (after video)

### Replay (Subsequent Attempts)
- **XP per correct answer**: 1 XP
- Example: 10 correct → 10 base XP → 20 final XP (after video)

### How to Detect
- Check `is_first_attempt` in `/level/start` response
- Show appropriate XP multiplier in UI (e.g., "+5 XP" vs "+1 XP")

---

## 5. Level Unlock Logic

**Requirements to unlock next level:**
1. Complete current level (answer all 10 questions)
2. Achieve ≥30% accuracy (3/10 correct answers)
3. Watch promotional video (≥80% duration)

**Important Notes:**
- Video watching is **REQUIRED** to unlock next level
- Unlock happens during `/video/complete` API call
- User can replay any unlocked level anytime
- `current_level` in user profile tracks highest unlocked level

**Example Flow:**
```
User starts at current_level = 1 (can play Level 1)
→ Completes Level 1 with 70% accuracy
→ Watches promotional video (≥80%)
→ Server returns level_unlocked = true, new_current_level = 2
→ Now user can play Levels 1 and 2
```

---

## 6. Replay vs First Attempt

### Detection
```
POST /level/start → { "is_first_attempt": false, "xp_per_correct": 1 }
```

### Differences
| Aspect | First Attempt | Replay |
|--------|--------------|--------|
| XP per correct | 5 XP | 1 XP |
| `is_first_attempt` | true | false |
| Level unlock | Yes (if ≥30%) | No (already unlocked) |
| Video watch | Required for unlock | Optional (for XP only) |

### UI Indicators
- Show replay badge/icon if `is_first_attempt` = false
- Display XP multiplier: "First Attempt: +5 XP each" vs "Replay: +1 XP each"

---

## 7. Level Abandonment (Optional)

If user exits quiz mid-level without completing:
```
POST /level/abandon
Body: { "attempt_id": 123 }
```
- Marks attempt as abandoned
- User can resume or restart level later

---

## 8. Resume Incomplete Level

```
GET /level/resume
```
- Returns incomplete level details if any
- Show "Resume Level X" prompt on home screen
- If user resumes, use returned `attempt_id`

---

## 9. Video Types

### 1. Lifeline Videos (`category: "lifeline"`)
```
GET /video/url?level=1&category=lifeline
```
- Shown when lifelines = 0
- Restores all 3 lifelines on ≥80% watch
- API: `POST /video/restore-lifelines`

### 2. Promotional Videos (`category: "promotional"`)
```
GET /video/url?level=1&category=promotional
```
- Shown after completing level
- Doubles XP and unlocks next level
- API: `POST /video/complete`

**Getting All Videos:**
```
GET /video/url?level=1
```
Returns array of both video types in `videos` array.

---

## 10. Additional APIs

### Get Level History
```
GET /user/level-history
```
Returns all levels with attempts, accuracy, and video status.

### Get Daily XP
```
GET /user/daily-xp
```
Last 30 days XP for charts/graphs.

### Get Leaderboard
```
GET /leaderboard/daily?date=2025-01-15
```
Top 50 users + current user's rank for specific date.

### Get User Stats
```
GET /user/stats
```
Comprehensive statistics (total questions, accuracy, streaks, etc.).

---

## 11. Error Handling

### Common Error Codes
- `LEVEL_LOCKED` - User trying to play locked level
- `INSUFFICIENT_WATCH_TIME` - Video not watched ≥80%
- `VIDEO_ALREADY_WATCHED` - Attempting to double-watch same video
- `INVALID_TOKEN` / `UNAUTHORIZED` - Token expired/invalid
- `RATE_LIMIT_EXCEEDED` - Too many OTP requests

### Error Response Format
```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable message"
}
```

**UI Actions:**
- Show error message from `message` field
- If `INVALID_TOKEN`, redirect to login
- If `LEVEL_LOCKED`, show lock icon with message

---

## 12. Important Implementation Notes

### Parsing Correct Answers
```kotlin
// Server returns: ["@New Delhi", "Mumbai", "Kolkata", "Chennai"]
val options = question.options
val correctIndex = options.indexOfFirst { it.startsWith("@") } + 1  // 1-based

// Remove @ for display
val displayOptions = options.map { it.removePrefix("@") }
```

### Video Watch Validation
```kotlin
// Server requires ≥80% watch time
val requiredWatchTime = (videoDuration * 0.8).toInt()

if (actualWatchTime >= requiredWatchTime) {
    // Call complete API
    completeVideo(attemptId, videoId, actualWatchTime)
} else {
    // Show "Please watch at least 80% of video" message
    // Don't call API (will fail validation)
}
```

### Token Storage
```kotlin
// Store securely (EncryptedSharedPreferences recommended)
// Token valid for 6 months
val token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
securePrefs.edit()
    .putString("jwt_token", token)
    .apply()

// Add to all API calls
val request = Request.Builder()
    .url("$BASE_URL/user/profile")
    .addHeader("Authorization", "Bearer $token")
    .build()
```

### Level Lock UI
```kotlin
// Show levels 1 to user.current_level as unlocked
for (level in 1..100) {
    if (level <= user.current_level) {
        levelButton.isEnabled = true
        levelButton.setBackgroundColor(Color.GREEN)  // Unlocked
    } else {
        levelButton.isEnabled = false
        levelButton.setBackgroundColor(Color.GRAY)  // Locked
        levelButton.setIcon(R.drawable.ic_lock)
    }
}
```

---

## 13. Complete Quiz Flow Sequence

```
┌─────────────────────────────────────────────────────────────┐
│ 1. APP START                                                │
│    ├─ Call POST /auth/validate-token                       │
│    └─ If success: Load user profile                        │
│       If fail: Show login screen                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. LEVEL SELECTION                                          │
│    ├─ GET /user/profile → current_level = 5                │
│    ├─ Show Levels 1-5 unlocked                             │
│    └─ Levels 6-100 locked                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. START LEVEL (User selects Level 3)                      │
│    ├─ POST /level/start { level: 3 }                       │
│    ├─ Store attempt_id = 42                                │
│    ├─ Show is_first_attempt badge                          │
│    ├─ Display xp_per_correct (5 or 1)                      │
│    └─ Initialize lifelines UI (3 hearts)                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. ANSWER QUESTIONS (Loop 10 times)                        │
│    For each question:                                       │
│    ├─ Show question with 4 options (@ removed)             │
│    ├─ User selects answer                                  │
│    ├─ POST /question/answer                                │
│    │   { attempt_id: 42, question_id: 21, user_answer: 1 }│
│    ├─ Show correct/wrong + explanation                     │
│    ├─ Update lifelines if wrong                            │
│    └─ If lifelines = 0:                                    │
│        ├─ Show "Restore Lifelines" button                  │
│        ├─ GET /video/url?level=3&category=lifeline         │
│        ├─ Play lifeline video                              │
│        ├─ Track watch time                                 │
│        └─ POST /video/restore-lifelines                    │
│            { attempt_id: 42, video_id: 6, watch: 45 }      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. LEVEL COMPLETED (All 10 questions answered)             │
│    ├─ Calculate accuracy: 7/10 = 70%                       │
│    ├─ Show results summary                                 │
│    ├─ Show "Watch Video to Double XP" prompt               │
│    └─ GET /video/url?level=3&category=promotional          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. WATCH PROMOTIONAL VIDEO                                 │
│    ├─ Play video from video_url                            │
│    ├─ Track watch time (start → end)                       │
│    ├─ Validate ≥80% watched                                │
│    └─ POST /video/complete                                 │
│        {                                                    │
│          attempt_id: 42,                                    │
│          video_id: 8,                                       │
│          watch_duration_seconds: 45                         │
│        }                                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. XP & UNLOCK RESPONSE                                    │
│    Response: {                                              │
│      xp_details: {                                          │
│        base_xp: 35,        // 7 correct × 5 XP             │
│        bonus_xp: 35,       // equals base                  │
│        final_xp: 70        // doubled!                     │
│      },                                                     │
│      user_progress: {                                       │
│        new_total_xp: 270,                                  │
│        level_unlocked: true,                                │
│        new_current_level: 4                                │
│      }                                                      │
│    }                                                        │
│    ├─ Animate XP: 35 → 70                                  │
│    ├─ Update user's total XP: 270                          │
│    └─ Show "Level 4 Unlocked!" animation                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 8. RETURN TO LEVEL SELECTION                               │
│    ├─ Now Levels 1-4 are unlocked                          │
│    ├─ User can replay any level 1-4                        │
│    └─ Level 5+ still locked                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 14. Testing Checklist

- [ ] First attempt shows 5 XP per correct
- [ ] Replay shows 1 XP per correct
- [ ] Lifelines decrease on wrong answers
- [ ] Lifeline restoration works at 0 lifelines
- [ ] Video watch time validation (≥80%)
- [ ] XP doubles after video watch
- [ ] Level unlocks at ≥30% accuracy + video
- [ ] Locked levels can't be started
- [ ] Token persists across app restarts
- [ ] Correct answer parsing (@ symbol)
- [ ] Error handling for all API failures

---

## 15. API Documentation Reference

For complete API details (request/response schemas, all fields, validation rules):
- See `CLAUDE.md` in repository
- Section: "API Architecture" (21 main endpoints)
- Section: "Important Implementation Notes"

For database schema and business logic:
- See `CLAUDE.md` sections: "XP Calculation Logic", "Level Unlock Logic", "Lifelines System"

---

**Last Updated**: 2025-11-24
**API Version**: v1
**Base URL**: https://quiz.tsblive.in/api/v1
