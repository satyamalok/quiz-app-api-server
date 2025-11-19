# Android Integration Guide - JNV Quiz App API

**Version**: 1.0.0
**Target SDK**: Android 13+ (API 33+)
**Language**: Kotlin
**Architecture**: MVVM + Repository Pattern
**Date**: November 19, 2025

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Dependencies](#dependencies)
3. [Network Configuration](#network-configuration)
4. [Data Models](#data-models)
5. [API Service Interface](#api-service-interface)
6. [Repository Layer](#repository-layer)
7. [Authentication Implementation](#authentication-implementation)
8. [Common Workflows](#common-workflows)
9. [Error Handling](#error-handling)
10. [Testing Checklist](#testing-checklist)

---

## Quick Start

### 1. Add Dependencies

Add to `build.gradle.kts` (Module: app):

```kotlin
dependencies {
    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.11.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.11.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")

    // ViewModel & LiveData
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.6.2")
    implementation("androidx.lifecycle:lifecycle-livedata-ktx:2.6.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.2")

    // Secure Storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Image Loading
    implementation("io.coil-kt:coil:2.4.0")
    implementation("io.coil-kt:coil-compose:2.4.0") // If using Compose

    // Video Player
    implementation("androidx.media3:media3-exoplayer:1.1.1")
    implementation("androidx.media3:media3-ui:1.1.1")

    // Gson
    implementation("com.google.code.gson:gson:2.10.1")
}
```

### 2. Internet Permission

Add to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<application
    android:usesCleartextTraffic="true">  <!-- Only for testing with HTTP -->
    ...
</application>
```

---

## Dependencies

### build.gradle.kts (Project)

```kotlin
plugins {
    id("com.android.application") version "8.1.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.10" apply false
}
```

### build.gradle.kts (Module)

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("kotlin-kapt")
    id("kotlin-parcelize")
}

android {
    namespace = "com.jnvquiz.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jnvquiz.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "BASE_URL", "\"http://your-domain.com/api/v1/\"")
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
```

---

## Network Configuration

### 1. API Constants

Create `app/src/main/java/com/jnvquiz/app/data/network/ApiConstants.kt`:

```kotlin
package com.jnvquiz.app.data.network

object ApiConstants {
    const val BASE_URL = "http://your-domain.com/api/v1/"

    // Timeouts
    const val CONNECT_TIMEOUT = 30L // seconds
    const val READ_TIMEOUT = 30L
    const val WRITE_TIMEOUT = 30L

    // Endpoints
    object Auth {
        const val SEND_OTP = "auth/send-otp"
        const val VERIFY_OTP = "auth/verify-otp"
        const val VALIDATE_TOKEN = "auth/validate-token"
    }

    object User {
        const val PROFILE = "user/profile"
        const val LEVEL_HISTORY = "user/level-history"
        const val DAILY_XP = "user/daily-xp"
        const val STREAK = "user/streak"
        const val STATS = "user/stats"
    }

    object Level {
        const val START = "level/start"
        const val RESUME = "level/resume"
        const val ABANDON = "level/abandon"
    }

    object Question {
        const val ANSWER = "question/answer"
    }

    object Video {
        const val URL = "video/url"
        const val COMPLETE = "video/complete"
        const val RESTORE_LIFELINES = "video/restore-lifelines"
    }

    object Leaderboard {
        const val DAILY = "leaderboard/daily"
    }

    object App {
        const val VERSION = "app/version"
        const val ONLINE_COUNT = "app/online-count"
    }
}
```

### 2. Retrofit Setup

Create `app/src/main/java/com/jnvquiz/app/data/network/RetrofitClient.kt`:

```kotlin
package com.jnvquiz.app.data.network

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {

    private var authToken: String? = null

    fun setAuthToken(token: String?) {
        authToken = token
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    private val authInterceptor = Interceptor { chain ->
        val requestBuilder = chain.request().newBuilder()

        authToken?.let {
            requestBuilder.addHeader("Authorization", "Bearer $it")
        }

        requestBuilder.addHeader("Content-Type", "application/json")

        chain.proceed(requestBuilder.build())
    }

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(loggingInterceptor)
        .addInterceptor(authInterceptor)
        .connectTimeout(ApiConstants.CONNECT_TIMEOUT, TimeUnit.SECONDS)
        .readTimeout(ApiConstants.READ_TIMEOUT, TimeUnit.SECONDS)
        .writeTimeout(ApiConstants.WRITE_TIMEOUT, TimeUnit.SECONDS)
        .build()

    private val retrofit: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl(ApiConstants.BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    val apiService: ApiService by lazy {
        retrofit.create(ApiService::class.java)
    }
}
```

### 3. Secure Token Storage

Create `app/src/main/java/com/jnvquiz/app/data/local/SecurePreferences.kt`:

```kotlin
package com.jnvquiz.app.data.local

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecurePreferences(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val sharedPreferences = EncryptedSharedPreferences.create(
        context,
        "jnv_quiz_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    companion object {
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_USER_PHONE = "user_phone"
        private const val KEY_USER_NAME = "user_name"
    }

    fun saveAuthToken(token: String) {
        sharedPreferences.edit().putString(KEY_AUTH_TOKEN, token).apply()
        RetrofitClient.setAuthToken(token)
    }

    fun getAuthToken(): String? {
        return sharedPreferences.getString(KEY_AUTH_TOKEN, null)
    }

    fun clearAuthToken() {
        sharedPreferences.edit().remove(KEY_AUTH_TOKEN).apply()
        RetrofitClient.setAuthToken(null)
    }

    fun saveUserPhone(phone: String) {
        sharedPreferences.edit().putString(KEY_USER_PHONE, phone).apply()
    }

    fun getUserPhone(): String? {
        return sharedPreferences.getString(KEY_USER_PHONE, null)
    }

    fun saveUserName(name: String) {
        sharedPreferences.edit().putString(KEY_USER_NAME, name).apply()
    }

    fun getUserName(): String? {
        return sharedPreferences.getString(KEY_USER_NAME, null)
    }

    fun clearAll() {
        sharedPreferences.edit().clear().apply()
        RetrofitClient.setAuthToken(null)
    }
}
```

---

## Data Models

Create `app/src/main/java/com/jnvquiz/app/data/models/`:

### ApiResponse.kt

```kotlin
package com.jnvquiz.app.data.models

import com.google.gson.annotations.SerializedName

data class ApiResponse<T>(
    @SerializedName("success") val success: Boolean,
    @SerializedName("data") val data: T? = null,
    @SerializedName("error") val error: String? = null,
    @SerializedName("message") val message: String? = null
)

// Generic error response
data class ErrorResponse(
    @SerializedName("success") val success: Boolean = false,
    @SerializedName("error") val error: String,
    @SerializedName("message") val message: String
)
```

### AuthModels.kt

```kotlin
package com.jnvquiz.app.data.models

import com.google.gson.annotations.SerializedName

// Send OTP Request
data class SendOtpRequest(
    @SerializedName("phone") val phone: String
)

// Send OTP Response
data class SendOtpResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String,
    @SerializedName("otp_expires_in") val otpExpiresIn: Int,
    @SerializedName("is_new_user") val isNewUser: Boolean,
    @SerializedName("test_mode_otp") val testModeOtp: String? = null
)

// Verify OTP Request
data class VerifyOtpRequest(
    @SerializedName("phone") val phone: String,
    @SerializedName("otp") val otp: String,
    @SerializedName("name") val name: String? = null,
    @SerializedName("district") val district: String? = null,
    @SerializedName("state") val state: String? = null,
    @SerializedName("referral_code") val referralCode: String? = null
)

// Verify OTP Response
data class VerifyOtpResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("is_new_user") val isNewUser: Boolean,
    @SerializedName("token") val token: String,
    @SerializedName("message") val message: String,
    @SerializedName("user") val user: User,
    @SerializedName("referral_bonus") val referralBonus: ReferralBonus? = null
)

data class ReferralBonus(
    @SerializedName("applied") val applied: Boolean,
    @SerializedName("xp_granted") val xpGranted: Int,
    @SerializedName("message") val message: String
)
```

### UserModels.kt

```kotlin
package com.jnvquiz.app.data.models

import android.os.Parcelable
import com.google.gson.annotations.SerializedName
import kotlinx.parcelize.Parcelize

@Parcelize
data class User(
    @SerializedName("phone") val phone: String,
    @SerializedName("name") val name: String?,
    @SerializedName("district") val district: String?,
    @SerializedName("state") val state: String?,
    @SerializedName("referral_code") val referralCode: String,
    @SerializedName("profile_image_url") val profileImageUrl: String?,
    @SerializedName("xp_total") val xpTotal: Int,
    @SerializedName("xp_today") val xpToday: Int? = 0,
    @SerializedName("current_level") val currentLevel: Int,
    @SerializedName("total_ads_watched") val totalAdsWatched: Int,
    @SerializedName("date_joined") val dateJoined: String,
    @SerializedName("streak") val streak: Streak? = null
) : Parcelable

@Parcelize
data class Streak(
    @SerializedName("current") val current: Int,
    @SerializedName("longest") val longest: Int,
    @SerializedName("last_active") val lastActive: String?
) : Parcelable

data class ProfileResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("user") val user: User
)

data class UpdateProfileRequest(
    @SerializedName("name") val name: String? = null,
    @SerializedName("district") val district: String? = null,
    @SerializedName("state") val state: String? = null
)

data class UserStats(
    @SerializedName("total_xp") val totalXp: Int,
    @SerializedName("levels_completed") val levelsCompleted: Int,
    @SerializedName("total_attempts") val totalAttempts: Int,
    @SerializedName("questions_attempted") val questionsAttempted: Int,
    @SerializedName("correct_answers") val correctAnswers: Int,
    @SerializedName("overall_accuracy") val overallAccuracy: Double,
    @SerializedName("videos_watched") val videosWatched: Int
)

data class UserStatsResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("stats") val stats: UserStats
)
```

### QuizModels.kt

```kotlin
package com.jnvquiz.app.data.models

import android.os.Parcelable
import com.google.gson.annotations.SerializedName
import kotlinx.parcelize.Parcelize

// Start Level Request
data class StartLevelRequest(
    @SerializedName("level") val level: Int
)

// Start Level Response
data class StartLevelResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("attempt_id") val attemptId: Int,
    @SerializedName("level") val level: Int,
    @SerializedName("is_first_attempt") val isFirstAttempt: Boolean,
    @SerializedName("xp_per_correct") val xpPerCorrect: Int,
    @SerializedName("lifelines_remaining") val lifelinesRemaining: Int,
    @SerializedName("questions") val questions: List<Question>
)

@Parcelize
data class Question(
    @SerializedName("sl") val id: Int,
    @SerializedName("question_order") val order: Int,
    @SerializedName("question_text") val text: String,
    @SerializedName("question_image_url") val imageUrl: String?,
    @SerializedName("options") val options: List<String>,
    @SerializedName("explanation_text") val explanationText: String,
    @SerializedName("explanation_url") val explanationUrl: String?,
    @SerializedName("subject") val subject: String,
    @SerializedName("topic") val topic: String
) : Parcelable {
    // Helper to get correct answer index (find option with @)
    fun getCorrectAnswerIndex(): Int {
        return options.indexOfFirst { it.startsWith("@") }
    }

    // Helper to get clean options (without @)
    fun getCleanOptions(): List<String> {
        return options.map { it.removePrefix("@") }
    }
}

// Answer Question Request
data class AnswerQuestionRequest(
    @SerializedName("attempt_id") val attemptId: Int,
    @SerializedName("question_id") val questionId: Int,
    @SerializedName("user_answer") val userAnswer: Int,
    @SerializedName("time_taken_seconds") val timeTakenSeconds: Int? = null
)

// Answer Question Response
data class AnswerQuestionResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("is_correct") val isCorrect: Boolean,
    @SerializedName("correct_answer") val correctAnswer: Int,
    @SerializedName("explanation_text") val explanationText: String,
    @SerializedName("explanation_url") val explanationUrl: String?,
    @SerializedName("progress") val progress: QuizProgress,
    @SerializedName("lifelines") val lifelines: LifelineStatus
)

data class QuizProgress(
    @SerializedName("questions_attempted") val questionsAttempted: Int,
    @SerializedName("correct_answers") val correctAnswers: Int,
    @SerializedName("accuracy_so_far") val accuracySoFar: Double
)

data class LifelineStatus(
    @SerializedName("remaining") val remaining: Int,
    @SerializedName("can_continue") val canContinue: Boolean,
    @SerializedName("can_watch_video_to_restore") val canWatchVideoToRestore: Boolean
)

// Resume Level Response
data class ResumeLevelResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("has_incomplete_level") val hasIncompleteLevel: Boolean,
    @SerializedName("resume_data") val resumeData: ResumeData? = null
)

data class ResumeData(
    @SerializedName("attempt_id") val attemptId: Int,
    @SerializedName("level") val level: Int,
    @SerializedName("questions_attempted") val questionsAttempted: Int,
    @SerializedName("questions_remaining") val questionsRemaining: Int,
    @SerializedName("lifelines_remaining") val lifelinesRemaining: Int
)

// Abandon Level Request
data class AbandonLevelRequest(
    @SerializedName("attempt_id") val attemptId: Int
)
```

### VideoModels.kt

```kotlin
package com.jnvquiz.app.data.models

import android.os.Parcelable
import com.google.gson.annotations.SerializedName
import kotlinx.parcelize.Parcelize

@Parcelize
data class Video(
    @SerializedName("id") val id: Int,
    @SerializedName("level") val level: Int,
    @SerializedName("video_name") val name: String,
    @SerializedName("video_url") val url: String,
    @SerializedName("duration_seconds") val durationSeconds: Int,
    @SerializedName("description") val description: String,
    @SerializedName("category") val category: String
) : Parcelable

data class VideoResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("video") val video: Video,
    @SerializedName("videos") val videos: List<Video>
)

// Complete Video Request
data class CompleteVideoRequest(
    @SerializedName("attempt_id") val attemptId: Int,
    @SerializedName("video_id") val videoId: Int,
    @SerializedName("watch_duration_seconds") val watchDurationSeconds: Int
)

// Complete Video Response
data class CompleteVideoResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("xp_details") val xpDetails: XpDetails,
    @SerializedName("user_progress") val userProgress: UserProgress
)

data class XpDetails(
    @SerializedName("base_xp") val baseXp: Int,
    @SerializedName("bonus_xp") val bonusXp: Int,
    @SerializedName("final_xp") val finalXp: Int,
    @SerializedName("message") val message: String
)

data class UserProgress(
    @SerializedName("new_total_xp") val newTotalXp: Int,
    @SerializedName("new_xp_today") val newXpToday: Int,
    @SerializedName("level_unlocked") val levelUnlocked: Boolean,
    @SerializedName("new_current_level") val newCurrentLevel: Int? = null
)

// Restore Lifelines Request
data class RestoreLifelinesRequest(
    @SerializedName("attempt_id") val attemptId: Int,
    @SerializedName("video_id") val videoId: Int,
    @SerializedName("watch_duration_seconds") val watchDurationSeconds: Int
)

// Restore Lifelines Response
data class RestoreLifelinesResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("lifelines_restored") val lifelinesRestored: Boolean,
    @SerializedName("new_lifelines_remaining") val newLifelinesRemaining: Int,
    @SerializedName("message") val message: String
)
```

### LeaderboardModels.kt

```kotlin
package com.jnvquiz.app.data.models

import com.google.gson.annotations.SerializedName

data class LeaderboardResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("date") val date: String,
    @SerializedName("user_stats") val userStats: UserLeaderboardStats,
    @SerializedName("top_50") val top50: List<LeaderboardEntry>
)

data class UserLeaderboardStats(
    @SerializedName("rank") val rank: Int?,
    @SerializedName("name") val name: String?,
    @SerializedName("today_xp") val todayXp: Int
)

data class LeaderboardEntry(
    @SerializedName("rank") val rank: Int,
    @SerializedName("phone") val phone: String,
    @SerializedName("name") val name: String,
    @SerializedName("district") val district: String?,
    @SerializedName("state") val state: String?,
    @SerializedName("today_xp") val todayXp: Int,
    @SerializedName("profile_image_url") val profileImageUrl: String?
)
```

---

## API Service Interface

Create `app/src/main/java/com/jnvquiz/app/data/network/ApiService.kt`:

```kotlin
package com.jnvquiz.app.data.network

import com.jnvquiz.app.data.models.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // ========================
    // AUTHENTICATION
    // ========================

    @POST(ApiConstants.Auth.SEND_OTP)
    suspend fun sendOtp(
        @Body request: SendOtpRequest
    ): Response<SendOtpResponse>

    @POST(ApiConstants.Auth.VERIFY_OTP)
    suspend fun verifyOtp(
        @Body request: VerifyOtpRequest
    ): Response<VerifyOtpResponse>

    @POST(ApiConstants.Auth.VALIDATE_TOKEN)
    suspend fun validateToken(
        @Body request: Map<String, String>
    ): Response<ApiResponse<User>>

    // ========================
    // USER PROFILE
    // ========================

    @GET(ApiConstants.User.PROFILE)
    suspend fun getProfile(): Response<ProfileResponse>

    @PATCH(ApiConstants.User.PROFILE)
    suspend fun updateProfile(
        @Body request: UpdateProfileRequest
    ): Response<ProfileResponse>

    @Multipart
    @PATCH(ApiConstants.User.PROFILE)
    suspend fun updateProfileWithImage(
        @Part("name") name: RequestBody?,
        @Part("district") district: RequestBody?,
        @Part("state") state: RequestBody?,
        @Part profileImage: MultipartBody.Part?
    ): Response<ProfileResponse>

    @GET(ApiConstants.User.LEVEL_HISTORY)
    suspend fun getLevelHistory(): Response<ApiResponse<List<LevelHistory>>>

    @GET(ApiConstants.User.DAILY_XP)
    suspend fun getDailyXp(): Response<ApiResponse<List<DailyXp>>>

    @GET(ApiConstants.User.STREAK)
    suspend fun getStreak(): Response<ApiResponse<Streak>>

    @GET(ApiConstants.User.STATS)
    suspend fun getUserStats(): Response<UserStatsResponse>

    // ========================
    // QUIZ/LEVEL
    // ========================

    @POST(ApiConstants.Level.START)
    suspend fun startLevel(
        @Body request: StartLevelRequest
    ): Response<StartLevelResponse>

    @GET(ApiConstants.Level.RESUME)
    suspend fun resumeLevel(): Response<ResumeLevelResponse>

    @POST(ApiConstants.Level.ABANDON)
    suspend fun abandonLevel(
        @Body request: AbandonLevelRequest
    ): Response<ApiResponse<String>>

    @POST(ApiConstants.Question.ANSWER)
    suspend fun answerQuestion(
        @Body request: AnswerQuestionRequest
    ): Response<AnswerQuestionResponse>

    // ========================
    // VIDEO
    // ========================

    @GET(ApiConstants.Video.URL)
    suspend fun getVideoUrl(
        @Query("level") level: Int,
        @Query("category") category: String? = null
    ): Response<VideoResponse>

    @POST(ApiConstants.Video.COMPLETE)
    suspend fun completeVideo(
        @Body request: CompleteVideoRequest
    ): Response<CompleteVideoResponse>

    @POST(ApiConstants.Video.RESTORE_LIFELINES)
    suspend fun restoreLifelines(
        @Body request: RestoreLifelinesRequest
    ): Response<RestoreLifelinesResponse>

    // ========================
    // LEADERBOARD & STATS
    // ========================

    @GET(ApiConstants.Leaderboard.DAILY)
    suspend fun getDailyLeaderboard(): Response<LeaderboardResponse>

    // ========================
    // APP CONFIG
    // ========================

    @GET(ApiConstants.App.VERSION)
    suspend fun checkAppVersion(): Response<ApiResponse<AppVersion>>

    @GET(ApiConstants.App.ONLINE_COUNT)
    suspend fun getOnlineCount(): Response<ApiResponse<OnlineCount>>
}
```

---

## Repository Layer

Create `app/src/main/java/com/jnvquiz/app/data/repository/`:

### AuthRepository.kt

```kotlin
package com.jnvquiz.app.data.repository

import com.jnvquiz.app.data.models.*
import com.jnvquiz.app.data.network.RetrofitClient
import com.jnvquiz.app.utils.Resource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AuthRepository {

    private val apiService = RetrofitClient.apiService

    suspend fun sendOtp(phone: String): Resource<SendOtpResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val response = apiService.sendOtp(SendOtpRequest(phone))
                if (response.isSuccessful && response.body() != null) {
                    Resource.Success(response.body()!!)
                } else {
                    val errorBody = response.errorBody()?.string()
                    Resource.Error(errorBody ?: "Unknown error occurred")
                }
            } catch (e: Exception) {
                Resource.Error(e.message ?: "Network error occurred")
            }
        }
    }

    suspend fun verifyOtp(
        phone: String,
        otp: String,
        name: String? = null,
        district: String? = null,
        state: String? = null,
        referralCode: String? = null
    ): Resource<VerifyOtpResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val request = VerifyOtpRequest(phone, otp, name, district, state, referralCode)
                val response = apiService.verifyOtp(request)

                if (response.isSuccessful && response.body() != null) {
                    Resource.Success(response.body()!!)
                } else {
                    val errorBody = response.errorBody()?.string()
                    Resource.Error(errorBody ?: "Verification failed")
                }
            } catch (e: Exception) {
                Resource.Error(e.message ?: "Network error")
            }
        }
    }

    suspend fun validateToken(token: String): Resource<User> {
        return withContext(Dispatchers.IO) {
            try {
                val response = apiService.validateToken(mapOf("token" to token))

                if (response.isSuccessful && response.body()?.success == true) {
                    response.body()?.data?.let {
                        Resource.Success(it)
                    } ?: Resource.Error("No data received")
                } else {
                    Resource.Error("Token validation failed")
                }
            } catch (e: Exception) {
                Resource.Error(e.message ?: "Network error")
            }
        }
    }
}
```

### Resource.kt (Helper Class)

Create `app/src/main/java/com/jnvquiz/app/utils/Resource.kt`:

```kotlin
package com.jnvquiz.app.utils

sealed class Resource<T>(
    val data: T? = null,
    val message: String? = null
) {
    class Success<T>(data: T) : Resource<T>(data)
    class Error<T>(message: String, data: T? = null) : Resource<T>(data, message)
    class Loading<T> : Resource<T>()
}
```

---

## Authentication Implementation

### LoginActivity.kt

```kotlin
package com.jnvquiz.app.ui.auth

import android.os.Bundle
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.jnvquiz.app.databinding.ActivityLoginBinding
import com.jnvquiz.app.utils.Resource
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private val viewModel: AuthViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupObservers()
        setupClickListeners()
    }

    private fun setupClickListeners() {
        binding.btnSendOtp.setOnClickListener {
            val phone = binding.etPhone.text.toString()
            if (validatePhone(phone)) {
                viewModel.sendOtp(phone)
            }
        }

        binding.btnVerifyOtp.setOnClickListener {
            val phone = binding.etPhone.text.toString()
            val otp = binding.etOtp.text.toString()
            val name = binding.etName.text.toString()
            val district = binding.etDistrict.text.toString()
            val state = binding.etState.text.toString()

            viewModel.verifyOtp(phone, otp, name, district, state)
        }
    }

    private fun setupObservers() {
        lifecycleScope.launch {
            viewModel.otpState.collect { resource ->
                when (resource) {
                    is Resource.Loading -> {
                        binding.btnSendOtp.isEnabled = false
                        binding.progressBar.visibility = View.VISIBLE
                    }
                    is Resource.Success -> {
                        binding.btnSendOtp.isEnabled = true
                        binding.progressBar.visibility = View.GONE
                        binding.layoutOtpInput.visibility = View.VISIBLE
                        Toast.makeText(this@LoginActivity, "OTP sent!", Toast.LENGTH_SHORT).show()
                    }
                    is Resource.Error -> {
                        binding.btnSendOtp.isEnabled = true
                        binding.progressBar.visibility = View.GONE
                        Toast.makeText(this@LoginActivity, resource.message, Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        lifecycleScope.launch {
            viewModel.verifyState.collect { resource ->
                when (resource) {
                    is Resource.Loading -> {
                        binding.btnVerifyOtp.isEnabled = false
                        binding.progressBar.visibility = View.VISIBLE
                    }
                    is Resource.Success -> {
                        // Save token and navigate to main screen
                        val token = resource.data?.token
                        token?.let { viewModel.saveToken(it) }

                        // Navigate to MainActivity
                        startActivity(Intent(this@LoginActivity, MainActivity::class.java))
                        finish()
                    }
                    is Resource.Error -> {
                        binding.btnVerifyOtp.isEnabled = true
                        binding.progressBar.visibility = View.GONE
                        Toast.makeText(this@LoginActivity, resource.message, Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    private fun validatePhone(phone: String): Boolean {
        return when {
            phone.isEmpty() -> {
                Toast.makeText(this, "Please enter phone number", Toast.LENGTH_SHORT).show()
                false
            }
            phone.length != 10 -> {
                Toast.makeText(this, "Phone number must be 10 digits", Toast.LENGTH_SHORT).show()
                false
            }
            else -> true
        }
    }
}
```

### AuthViewModel.kt

```kotlin
package com.jnvquiz.app.ui.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jnvquiz.app.data.local.SecurePreferences
import com.jnvquiz.app.data.models.*
import com.jnvquiz.app.data.repository.AuthRepository
import com.jnvquiz.app.utils.Resource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class AuthViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = AuthRepository()
    private val securePrefs = SecurePreferences(application)

    private val _otpState = MutableStateFlow<Resource<SendOtpResponse>>(Resource.Loading())
    val otpState: StateFlow<Resource<SendOtpResponse>> = _otpState

    private val _verifyState = MutableStateFlow<Resource<VerifyOtpResponse>>(Resource.Loading())
    val verifyState: StateFlow<Resource<VerifyOtpResponse>> = _verifyState

    fun sendOtp(phone: String) {
        viewModelScope.launch {
            _otpState.value = Resource.Loading()
            _otpState.value = repository.sendOtp(phone)
        }
    }

    fun verifyOtp(
        phone: String,
        otp: String,
        name: String? = null,
        district: String? = null,
        state: String? = null,
        referralCode: String? = null
    ) {
        viewModelScope.launch {
            _verifyState.value = Resource.Loading()
            _verifyState.value = repository.verifyOtp(phone, otp, name, district, state, referralCode)
        }
    }

    fun saveToken(token: String) {
        securePrefs.saveAuthToken(token)
    }

    fun getToken(): String? {
        return securePrefs.getAuthToken()
    }

    fun clearToken() {
        securePrefs.clearAuthToken()
    }
}
```

---

## Common Workflows

### 1. Quiz Flow Implementation

```kotlin
class QuizViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = QuizRepository()

    private val _quizState = MutableStateFlow<QuizState>(QuizState.Idle)
    val quizState: StateFlow<QuizState> = _quizState

    private var currentAttemptId: Int? = null
    private var currentQuestions: List<Question> = emptyList()
    private var currentQuestionIndex = 0

    fun startLevel(level: Int) {
        viewModelScope.launch {
            _quizState.value = QuizState.Loading

            when (val result = repository.startLevel(level)) {
                is Resource.Success -> {
                    currentAttemptId = result.data?.attemptId
                    currentQuestions = result.data?.questions ?: emptyList()
                    currentQuestionIndex = 0

                    _quizState.value = QuizState.QuestionLoaded(
                        question = currentQuestions[0],
                        questionNumber = 1,
                        totalQuestions = 10
                    )
                }
                is Resource.Error -> {
                    _quizState.value = QuizState.Error(result.message ?: "Failed to start level")
                }
            }
        }
    }

    fun submitAnswer(questionId: Int, userAnswer: Int, timeTaken: Int) {
        viewModelScope.launch {
            currentAttemptId?.let { attemptId ->
                _quizState.value = QuizState.CheckingAnswer

                when (val result = repository.answerQuestion(attemptId, questionId, userAnswer, timeTaken)) {
                    is Resource.Success -> {
                        val data = result.data
                        _quizState.value = QuizState.AnswerChecked(
                            isCorrect = data?.isCorrect ?: false,
                            correctAnswer = data?.correctAnswer ?: 0,
                            explanation = data?.explanationText ?: "",
                            progress = data?.progress,
                            lifelines = data?.lifelines
                        )

                        // Move to next question or complete quiz
                        currentQuestionIndex++
                        if (currentQuestionIndex < currentQuestions.size) {
                            // Load next question after delay
                            delay(2000)
                            loadNextQuestion()
                        } else {
                            _quizState.value = QuizState.QuizCompleted
                        }
                    }
                    is Resource.Error -> {
                        _quizState.value = QuizState.Error(result.message ?: "Failed to submit answer")
                    }
                }
            }
        }
    }

    private fun loadNextQuestion() {
        _quizState.value = QuizState.QuestionLoaded(
            question = currentQuestions[currentQuestionIndex],
            questionNumber = currentQuestionIndex + 1,
            totalQuestions = 10
        )
    }
}

sealed class QuizState {
    object Idle : QuizState()
    object Loading : QuizState()
    object CheckingAnswer : QuizState()
    data class QuestionLoaded(
        val question: Question,
        val questionNumber: Int,
        val totalQuestions: Int
    ) : QuizState()
    data class AnswerChecked(
        val isCorrect: Boolean,
        val correctAnswer: Int,
        val explanation: String,
        val progress: QuizProgress?,
        val lifelines: LifelineStatus?
    ) : QuizState()
    object QuizCompleted : QuizState()
    data class Error(val message: String) : QuizState()
}
```

### 2. Video Player with Watch Tracking

```kotlin
class VideoPlayerActivity : AppCompatActivity() {

    private lateinit var player: ExoPlayer
    private var startTime: Long = 0
    private var totalWatchedSeconds = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val videoUrl = intent.getStringExtra("VIDEO_URL")
        val videoDuration = intent.getIntExtra("VIDEO_DURATION", 0)
        val attemptId = intent.getIntExtra("ATTEMPT_ID", 0)
        val videoId = intent.getIntExtra("VIDEO_ID", 0)

        setupPlayer(videoUrl)
        setupPlayerListener(videoDuration, attemptId, videoId)
    }

    private fun setupPlayer(videoUrl: String?) {
        player = ExoPlayer.Builder(this).build()
        binding.playerView.player = player

        val mediaItem = MediaItem.fromUri(videoUrl ?: "")
        player.setMediaItem(mediaItem)
        player.prepare()
        player.play()

        startTime = System.currentTimeMillis()
    }

    private fun setupPlayerListener(
        videoDuration: Int,
        attemptId: Int,
        videoId: Int
    ) {
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) {
                    val watchedSeconds = ((System.currentTimeMillis() - startTime) / 1000).toInt()
                    completeVideo(attemptId, videoId, watchedSeconds, videoDuration)
                }
            }
        })
    }

    private fun completeVideo(
        attemptId: Int,
        videoId: Int,
        watchedSeconds: Int,
        videoDuration: Int
    ) {
        val watchPercentage = (watchedSeconds.toFloat() / videoDuration) * 100

        if (watchPercentage >= 80) {
            // Call complete video API
            viewModel.completeVideo(attemptId, videoId, watchedSeconds)
        } else {
            Toast.makeText(
                this,
                "Watch at least 80% to get XP bonus!",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        player.release()
    }
}
```

---

## Error Handling

### Global Error Handler

Create `app/src/main/java/com/jnvquiz/app/utils/ErrorHandler.kt`:

```kotlin
package com.jnvquiz.app.utils

import android.content.Context
import android.widget.Toast
import com.google.gson.Gson
import com.jnvquiz.app.data.models.ErrorResponse
import retrofit2.Response

object ErrorHandler {

    fun <T> handleApiError(context: Context, response: Response<T>): String {
        return try {
            val errorBody = response.errorBody()?.string()
            val errorResponse = Gson().fromJson(errorBody, ErrorResponse::class.java)

            when (errorResponse.error) {
                "TOKEN_EXPIRED" -> {
                    "Session expired. Please login again"
                }
                "LEVEL_LOCKED" -> {
                    errorResponse.message
                }
                "INSUFFICIENT_WATCH_TIME" -> {
                    "Please watch at least 80% of the video"
                }
                "RATE_LIMIT_EXCEEDED" -> {
                    "Too many requests. Please wait"
                }
                else -> {
                    errorResponse.message
                }
            }
        } catch (e: Exception) {
            "An error occurred. Please try again"
        }
    }

    fun showError(context: Context, message: String) {
        Toast.makeText(context, message, Toast.LENGTH_LONG).show()
    }
}
```

---

## Testing Checklist

### Functional Testing

- [ ] OTP send and verification flow
- [ ] Token storage and auto-login
- [ ] Profile creation and updates
- [ ] Profile image upload
- [ ] Level start and question loading
- [ ] Answer submission (correct/wrong)
- [ ] Lifeline deduction on wrong answer
- [ ] Video playback and tracking
- [ ] XP doubling after 80% video watch
- [ ] Lifeline restoration via video
- [ ] Level unlock on completion
- [ ] Leaderboard display
- [ ] Streak tracking
- [ ] Referral code application

### Error Handling Testing

- [ ] Invalid phone number
- [ ] Wrong OTP
- [ ] Expired OTP
- [ ] Invalid token
- [ ] Locked level access attempt
- [ ] Network error handling
- [ ] Server error (500) handling
- [ ] Less than 80% video watch

### Edge Cases

- [ ] App restart with saved token
- [ ] Background/foreground transitions during quiz
- [ ] Video playback interruption
- [ ] Network loss during API call
- [ ] Rapid button clicks (debouncing)

---

**End of Android Integration Guide**

For further assistance, refer to the complete API documentation or contact the development team.
