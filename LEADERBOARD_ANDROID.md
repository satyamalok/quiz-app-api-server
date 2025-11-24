# Leaderboard Implementation Guide - Android

**Base URL**: `https://quiz.tsblive.in/api/v1`
**Authentication**: All endpoints require `Authorization: Bearer <jwt_token>` header

---

## Overview

The leaderboard system displays daily rankings based on XP earned today. Users can see:
- Top 50 users for any date
- Their own rank and stats
- Current online users count (motivational fake count)
- User profiles (limited to own profile currently)

---

## 1. Daily Leaderboard API

### Endpoint
```
GET /leaderboard/daily?date=YYYY-MM-DD
```

### Parameters
- `date` (optional) - Format: `YYYY-MM-DD` (e.g., `2025-11-24`)
- If not provided, defaults to today's date

### Request Example
```kotlin
val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
val request = Request.Builder()
    .url("$BASE_URL/leaderboard/daily?date=$date")
    .addHeader("Authorization", "Bearer $token")
    .build()
```

### Response Structure
```json
{
  "success": true,
  "date": "2025-11-24",
  "user_stats": {
    "rank": "2",
    "name": null,
    "today_xp": 70,
    "total_xp": 70
  },
  "top_50": [
    {
      "rank": 1,
      "name": null,
      "district": null,
      "today_xp": 290
    },
    {
      "rank": 2,
      "name": null,
      "district": null,
      "today_xp": 70
    },
    {
      "rank": 3,
      "name": null,
      "district": null,
      "today_xp": 50
    }
  ]
}
```

### Response Fields

**user_stats** (Current logged-in user):
- `rank` (String) - User's current rank (e.g., "1", "2", "51", ">50")
- `name` (String|null) - User's name if profile completed
- `today_xp` (Number) - XP earned today
- `total_xp` (Number) - All-time XP

**top_50** (Array of top 50 users):
- `rank` (Number) - Position in leaderboard (1-50)
- `name` (String|null) - User's name (null if not set)
- `district` (String|null) - User's district (null if not set)
- `today_xp` (Number) - XP earned on this date

### Important Notes
- **No phone numbers exposed** - Privacy protected
- Rankings sorted by `today_xp` (descending)
- If user rank > 50, they appear separately in `user_stats` but not in `top_50`
- `name` and `district` are null if user hasn't completed profile

---

## 2. User Profile API

### Endpoint
```
GET /user/profile
```

### Purpose
- Get detailed profile of **authenticated user only**
- Used to display current user's full stats
- **Cannot view other users' profiles** (limitation)

### Request Example
```kotlin
val request = Request.Builder()
    .url("$BASE_URL/user/profile")
    .addHeader("Authorization", "Bearer $token")
    .build()
```

### Response Structure
```json
{
  "success": true,
  "user": {
    "phone": "9999999998",
    "name": null,
    "district": null,
    "state": null,
    "referral_code": "67458",
    "profile_image_url": null,
    "xp_total": 290,
    "xp_today": 290,
    "current_level": 4,
    "total_ads_watched": 4,
    "date_joined": "2025-11-24T00:00:00.000Z",
    "streak": {
      "current": 0,
      "longest": 0,
      "last_active": null
    }
  }
}
```

### Response Fields
- `phone` - User's phone number
- `name` - Display name (null if not set)
- `district` - District (null if not set)
- `state` - State (null if not set)
- `referral_code` - 5-digit referral code
- `profile_image_url` - Profile picture URL (null if not uploaded)
- `xp_total` - All-time XP
- `xp_today` - Today's XP
- `current_level` - Highest unlocked level (1-100)
- `total_ads_watched` - Number of promotional videos watched
- `date_joined` - Registration date
- `streak.current` - Current activity streak (days)
- `streak.longest` - Longest streak achieved

---

## 3. Online Count API

### Endpoint
```
GET /app/online-count
```

### Purpose
- Shows fake/configurable online user count for motivation
- Updates periodically based on admin configuration
- Configurable range (min-max) in backend

### Request Example
```kotlin
val request = Request.Builder()
    .url("$BASE_URL/app/online-count")
    .addHeader("Authorization", "Bearer $token")
    .build()
```

### Response Structure
```json
{
  "success": true,
  "online_users": 442,
  "message": "442 students are studying now!"
}
```

### Response Fields
- `online_users` (Number) - Current online count
- `message` (String) - Display-ready message

### UI Usage
```kotlin
// Display at top of leaderboard or home screen
"🟢 ${response.online_users} students studying now"
```

---

## 4. Complete Leaderboard UI Flow

### Screen Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ LEADERBOARD - November 24, 2025                         │
│ ───────────────────────────────────────────────────────│
│ 🟢 442 students studying now                            │
│ ───────────────────────────────────────────────────────│
│                                                          │
│ YOUR RANK                                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🥈 #2         70 XP today        Total: 70 XP      │ │
│ │ Anonymous (You)                                     │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ TOP USERS                                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🥇 #1                                     290 XP    │ │
│ │    Anonymous                                        │ │
│ │    [District not set]                               │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🥈 #2                                      70 XP    │ │
│ │    Anonymous (You)                                  │ │
│ │    [District not set]                               │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🥉 #3                                      50 XP    │ │
│ │    Anonymous                                        │ │
│ │    [District not set]                               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ [Calendar Icon] Change Date                              │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Implementation Flow

### Step 1: Fetch Leaderboard on Screen Load

```kotlin
class LeaderboardFragment : Fragment() {
    private lateinit var token: String
    private val currentDate: String
        get() = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        token = getStoredToken() // From SharedPreferences

        // Load all data in parallel
        loadLeaderboard(currentDate)
        loadOnlineCount()
    }

    private fun loadLeaderboard(date: String) {
        viewModelScope.launch {
            try {
                val response = api.getDailyLeaderboard(date, token)
                updateUI(response)
            } catch (e: Exception) {
                showError(e.message)
            }
        }
    }
}
```

### Step 2: Display Current User Stats (Highlighted Card)

```kotlin
private fun displayUserStats(userStats: UserStats) {
    // Show highlighted card at top
    binding.userRankCard.visibility = View.VISIBLE
    binding.userRankText.text = "#${userStats.rank}"
    binding.userNameText.text = userStats.name ?: "Anonymous (You)"
    binding.userTodayXP.text = "${userStats.today_xp} XP today"
    binding.userTotalXP.text = "Total: ${userStats.total_xp} XP"

    // Add medal icon for top 3
    when (userStats.rank.toIntOrNull()) {
        1 -> binding.medalIcon.text = "🥇"
        2 -> binding.medalIcon.text = "🥈"
        3 -> binding.medalIcon.text = "🥉"
        else -> binding.medalIcon.visibility = View.GONE
    }

    // Highlight if user in top 50
    if (userStats.rank.toIntOrNull() != null && userStats.rank.toInt() <= 50) {
        binding.userRankCard.setBackgroundColor(Color.parseColor("#FFF9C4"))
    }
}
```

### Step 3: Display Top 50 List (RecyclerView)

```kotlin
class LeaderboardAdapter(
    private val users: List<LeaderboardUser>,
    private val currentUserRank: String
) : RecyclerView.Adapter<LeaderboardAdapter.ViewHolder>() {

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val user = users[position]

        // Rank with medal
        holder.rankText.text = when (user.rank) {
            1 -> "🥇 #1"
            2 -> "🥈 #2"
            3 -> "🥉 #3"
            else -> "#${user.rank}"
        }

        // Name with fallback
        holder.nameText.text = user.name ?: "Anonymous"

        // District with fallback
        holder.districtText.text = user.district ?: "[District not set]"
        holder.districtText.setTextColor(
            if (user.district == null) Color.GRAY else Color.BLACK
        )

        // XP
        holder.xpText.text = "${user.today_xp} XP"

        // Highlight current user
        if (user.rank.toString() == currentUserRank) {
            holder.itemView.setBackgroundColor(Color.parseColor("#E3F2FD"))
            holder.nameText.text = "${holder.nameText.text} (You)"
        }
    }
}
```

### Step 4: Handle Date Selection

```kotlin
private fun showDatePicker() {
    val calendar = Calendar.getInstance()
    val datePicker = DatePickerDialog(
        requireContext(),
        { _, year, month, dayOfMonth ->
            calendar.set(year, month, dayOfMonth)
            val selectedDate = SimpleDateFormat("yyyy-MM-dd", Locale.US)
                .format(calendar.time)
            loadLeaderboard(selectedDate)
        },
        calendar.get(Calendar.YEAR),
        calendar.get(Calendar.MONTH),
        calendar.get(Calendar.DAY_OF_MONTH)
    )

    // Don't allow future dates
    datePicker.datePicker.maxDate = System.currentTimeMillis()
    datePicker.show()
}
```

### Step 5: Display Online Count

```kotlin
private fun loadOnlineCount() {
    viewModelScope.launch {
        try {
            val response = api.getOnlineCount(token)
            binding.onlineCountText.text = "🟢 ${response.online_users} students studying now"

            // Add pulse animation
            binding.onlineCountText.startAnimation(
                AnimationUtils.loadAnimation(context, R.anim.pulse)
            )
        } catch (e: Exception) {
            // Hide if fails
            binding.onlineCountText.visibility = View.GONE
        }
    }
}
```

### Step 6: Pull to Refresh

```kotlin
binding.swipeRefreshLayout.setOnRefreshListener {
    loadLeaderboard(currentDate)
    loadOnlineCount()
    binding.swipeRefreshLayout.isRefreshing = false
}
```

---

## 6. Handling User Profile Clicks

### Current Limitation
The API **only returns the authenticated user's profile**. You cannot view other users' profiles.

### Option 1: Show Own Profile Only
```kotlin
leaderboardAdapter.setOnItemClickListener { user, position ->
    if (user.rank.toString() == currentUserRank) {
        // User clicked their own entry - show full profile
        navigateToProfile()
    } else {
        // Other user - show toast
        Toast.makeText(
            context,
            "Profile viewing for other users coming soon!",
            Toast.LENGTH_SHORT
        ).show()
    }
}
```

### Option 2: Show Limited Info Dialog
```kotlin
private fun showUserInfoDialog(user: LeaderboardUser) {
    MaterialAlertDialogBuilder(requireContext())
        .setTitle("User #${user.rank}")
        .setMessage("""
            Name: ${user.name ?: "Anonymous"}
            District: ${user.district ?: "Not set"}
            Today's XP: ${user.today_xp}

            Full profiles coming soon!
        """.trimIndent())
        .setPositiveButton("OK", null)
        .show()
}
```

### Option 3: Request Backend Enhancement
Ask backend developer to add:
```
GET /user/public-profile/:referral_code
or
GET /leaderboard/user/:rank?date=YYYY-MM-DD
```

This would return public profile data for any user on leaderboard.

---

## 7. Data Models (Kotlin)

```kotlin
// Leaderboard Response
data class LeaderboardResponse(
    val success: Boolean,
    val date: String,
    val user_stats: UserStats,
    val top_50: List<LeaderboardUser>
)

data class UserStats(
    val rank: String,  // "1", "2", ">50"
    val name: String?,
    val today_xp: Int,
    val total_xp: Int
)

data class LeaderboardUser(
    val rank: Int,
    val name: String?,
    val district: String?,
    val today_xp: Int
)

// Online Count Response
data class OnlineCountResponse(
    val success: Boolean,
    val online_users: Int,
    val message: String
)

// User Profile Response
data class ProfileResponse(
    val success: Boolean,
    val user: UserProfile
)

data class UserProfile(
    val phone: String,
    val name: String?,
    val district: String?,
    val state: String?,
    val referral_code: String,
    val profile_image_url: String?,
    val xp_total: Int,
    val xp_today: Int,
    val current_level: Int,
    val total_ads_watched: Int,
    val date_joined: String,
    val streak: Streak
)

data class Streak(
    val current: Int,
    val longest: Int,
    val last_active: String?
)
```

---

## 8. Retrofit API Interface

```kotlin
interface QuizApiService {
    @GET("leaderboard/daily")
    suspend fun getDailyLeaderboard(
        @Query("date") date: String,
        @Header("Authorization") authHeader: String
    ): LeaderboardResponse

    @GET("user/profile")
    suspend fun getUserProfile(
        @Header("Authorization") authHeader: String
    ): ProfileResponse

    @GET("app/online-count")
    suspend fun getOnlineCount(
        @Header("Authorization") authHeader: String
    ): OnlineCountResponse
}

// Usage
val api = Retrofit.Builder()
    .baseUrl("https://quiz.tsblive.in/api/v1/")
    .addConverterFactory(GsonConverterFactory.create())
    .build()
    .create(QuizApiService::class.java)
```

---

## 9. Error Handling

### Common Errors

| Error Code | Meaning | UI Action |
|------------|---------|-----------|
| `UNAUTHORIZED` | Token expired/invalid | Redirect to login |
| No data (empty top_50) | No users for this date | Show "No data" message |
| Network error | Connection failed | Show retry button |

### Error Handling Example
```kotlin
try {
    val response = api.getDailyLeaderboard(date, "Bearer $token")

    if (response.top_50.isEmpty()) {
        showEmptyState("No users on leaderboard for this date")
    } else {
        displayLeaderboard(response)
    }

} catch (e: HttpException) {
    when (e.code()) {
        401 -> {
            // Token expired
            clearTokenAndRedirectToLogin()
        }
        404 -> {
            showEmptyState("No leaderboard data available")
        }
        else -> {
            showError("Failed to load leaderboard: ${e.message()}")
        }
    }
} catch (e: Exception) {
    showError("Network error: ${e.localizedMessage}")
}
```

---

## 10. UI Best Practices

### Highlight Current User
```kotlin
// Always highlight current user's entry in list
if (user.rank.toString() == userStats.rank) {
    itemView.setBackgroundColor(Color.parseColor("#BBDEFB"))
    itemView.elevation = 4.dp
}
```

### Medal Icons
```kotlin
// Use emoji medals for top 3
val medal = when (rank) {
    1 -> "🥇"
    2 -> "🥈"
    3 -> "🥉"
    else -> ""
}
```

### Anonymous Users
```kotlin
// Fallback for incomplete profiles
val displayName = user.name ?: "Anonymous"
val displayDistrict = user.district ?: "[District not set]"
```

### Date Display
```kotlin
// Show friendly date format
val dateFormat = SimpleDateFormat("MMMM dd, yyyy", Locale.US)
binding.dateText.text = "Leaderboard - ${dateFormat.format(selectedDate)}"
```

### Pull to Refresh
```kotlin
// Add SwipeRefreshLayout for better UX
binding.swipeRefreshLayout.setColorSchemeResources(
    R.color.colorPrimary,
    R.color.colorAccent
)
```

---

## 11. Caching Strategy (Optional)

### Cache Today's Leaderboard
```kotlin
// Cache for 5 minutes to reduce API calls
private val cache = mutableMapOf<String, Pair<LeaderboardResponse, Long>>()

private fun getCachedLeaderboard(date: String): LeaderboardResponse? {
    val cached = cache[date] ?: return null
    val age = System.currentTimeMillis() - cached.second
    return if (age < 5 * 60 * 1000) cached.first else null
}

private fun loadLeaderboard(date: String) {
    // Check cache first
    getCachedLeaderboard(date)?.let {
        displayLeaderboard(it)
        return
    }

    // Fetch from API
    viewModelScope.launch {
        val response = api.getDailyLeaderboard(date, "Bearer $token")
        cache[date] = response to System.currentTimeMillis()
        displayLeaderboard(response)
    }
}
```

---

## 12. Testing Checklist

- [ ] Leaderboard loads with correct date
- [ ] Current user highlighted in list
- [ ] Top 3 show medal icons (🥇🥈🥉)
- [ ] Anonymous users show fallback text
- [ ] Date picker works and updates leaderboard
- [ ] Pull to refresh works
- [ ] Online count displays at top
- [ ] User stats card shows correct rank and XP
- [ ] Empty state shown when no data
- [ ] Error handling for network failures
- [ ] Token expiration redirects to login
- [ ] Profile click shows appropriate message
- [ ] Scrolling smooth with 50+ entries

---

## 13. Future Enhancements (Backend Required)

### Public Profile Viewing
```
GET /user/public-profile/:referral_code
```
Would allow viewing any user's public profile from leaderboard.

### Enhanced Leaderboard Details
Include more fields in `top_50`:
```json
{
  "rank": 1,
  "name": "John Doe",
  "district": "Delhi",
  "today_xp": 290,
  "total_xp": 290,
  "current_level": 4,
  "profile_image_url": "...",
  "referral_code": "67458"
}
```

### Historical Leaderboards
```
GET /leaderboard/history?start_date=...&end_date=...
```
View leaderboards across date ranges.

---

## 14. Complete Sequence Diagram

```
┌─────────────┐                    ┌─────────────┐
│   Android   │                    │  API Server │
│     App     │                    │             │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. App Opens Leaderboard Screen │
       │                                  │
       │ GET /leaderboard/daily?date=...  │
       │ Authorization: Bearer <token>    │
       │─────────────────────────────────>│
       │                                  │
       │        Leaderboard Response      │
       │<─────────────────────────────────│
       │  { user_stats, top_50 }          │
       │                                  │
       │ 2. Load Online Count             │
       │                                  │
       │ GET /app/online-count            │
       │─────────────────────────────────>│
       │                                  │
       │    Online Count Response         │
       │<─────────────────────────────────│
       │  { online_users: 442 }           │
       │                                  │
       │ 3. Display UI                    │
       │  - Highlight current user        │
       │  - Show top 50 list              │
       │  - Show online count             │
       │                                  │
       │ 4. User Clicks Own Entry         │
       │                                  │
       │ GET /user/profile                │
       │─────────────────────────────────>│
       │                                  │
       │      Full Profile Response       │
       │<─────────────────────────────────│
       │  { user: {...} }                 │
       │                                  │
       │ 5. Navigate to Profile Screen    │
       │                                  │
       │ 6. User Changes Date             │
       │                                  │
       │ GET /leaderboard/daily?date=...  │
       │─────────────────────────────────>│
       │                                  │
       │    Updated Leaderboard           │
       │<─────────────────────────────────│
       │                                  │
```

---

**Last Updated**: 2025-11-24
**API Version**: v1
**Base URL**: https://quiz.tsblive.in/api/v1

**For Complete API Documentation**: See `CLAUDE.md` and `API_DOCUMENTATION.md`
