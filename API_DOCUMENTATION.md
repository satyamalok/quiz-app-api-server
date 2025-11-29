# JNV Quiz App - Complete API Documentation

**Version**: 1.2.0
**Base URL**: `http://your-domain.com/api/v1`
**Authentication**: JWT Bearer Token
**Date**: November 26, 2025

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Error Handling](#error-handling)
4. [API Endpoints](#api-endpoints)
   - [Authentication APIs](#1-authentication-apis)
   - [User Profile APIs](#2-user-profile-apis)
   - [Quiz/Level APIs](#3-quizlevel-apis)
   - [Video APIs](#4-video-apis)
   - [Statistics APIs](#5-statistics-apis)
   - [App Configuration APIs](#6-app-configuration-apis)
   - [Reels APIs](#7-reels-apis) *(NEW)*
   - [Quiz Levels Metadata APIs](#8-quiz-levels-metadata-apis-unauthenticated) *(NEW - Unauthenticated)*
5. [Common Workflows](#common-workflows)
6. [Data Types & Enums](#data-types--enums)

---

## Overview

This API powers the JNV Quiz App, a gamified learning platform with:
- Phone-based OTP authentication
- Level-based quiz system with 10 questions per level
- Lifelines system (3 hearts, deducted on wrong answers)
- XP rewards (base XP + video bonus that doubles XP)
- Video integration for XP bonuses and lifeline restoration
- Leaderboards and streak tracking
- Two-way referral tracking system (earn XP by referring friends)
- **Language medium support** (Hindi/English questions)
- **Video Reels** (TikTok/Shorts-style educational content) *(NEW)*

---

## Authentication

### JWT Token

All protected endpoints require a JWT token in the Authorization header:

```http
Authorization: Bearer <your_jwt_token>
```

**Token Validity**: 180 days
**Token Payload**: `{ phone: "1234567890", iat: ..., exp: ... }`

### How to Get Token

1. Call `POST /auth/send-otp` to receive OTP
2. Call `POST /auth/verify-otp` with OTP to get JWT token
3. Use the token in all subsequent API calls

---

## Error Handling

### Error Response Format

All errors follow this structure:

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable error message"
}
```

### Common HTTP Status Codes

| Code | Meaning | When It Occurs |
|------|---------|----------------|
| 200 | Success | Request completed successfully |
| 400 | Bad Request | Invalid request data/parameters |
| 401 | Unauthorized | Missing or invalid JWT token |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |

### Common Error Codes

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `INVALID_PHONE` | 400 | Phone number format invalid |
| `OTP_EXPIRED` | 400 | OTP has expired (5 min validity) |
| `INVALID_OTP` | 400 | Incorrect OTP provided |
| `TOKEN_EXPIRED` | 401 | JWT token has expired |
| `TOKEN_INVALID` | 401 | JWT token is invalid |
| `USER_NOT_FOUND` | 404 | User does not exist |
| `LEVEL_LOCKED` | 403 | Level not yet unlocked |
| `QUESTION_NOT_FOUND` | 404 | Question does not exist |
| `VIDEO_NOT_FOUND` | 404 | Video not found for level |
| `ATTEMPT_NOT_FOUND` | 404 | Level attempt not found |
| `INSUFFICIENT_WATCH_TIME` | 400 | Video watched less than 80% |
| `INVALID_REFERRAL_CODE` | 400 | Referral code does not exist |
| `SELF_REFERRAL_NOT_ALLOWED` | 400 | Cannot use your own referral code |
| `ALREADY_REFERRED` | 400 | User already used a referral code |
| `INVALID_LIMIT` | 400 | Pagination limit out of range (1-100) |
| `INVALID_OFFSET` | 400 | Pagination offset must be >= 0 |
| `REEL_NOT_FOUND` | 404 | Reel does not exist |

---

## API Endpoints

## 1. AUTHENTICATION APIS

### 1.1 Send OTP

Send OTP to phone number for authentication.

**Endpoint**: `POST /auth/send-otp`
**Authentication**: None
**Rate Limit**: 3 requests per 5 minutes per phone

#### Request Body

```json
{
  "phone": "string (10 digits, required)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "otp_expires_in": 300,
  "is_new_user": true,
  "test_mode_otp": "123456"  // Only in test mode
}
```

#### Error Responses

**400 - Invalid Phone**
```json
{
  "success": false,
  "error": "INVALID_PHONE",
  "message": "Phone number must be 10 digits"
}
```

**429 - Too Many Requests**
```json
{
  "success": false,
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many OTP requests. Please try again in 5 minutes"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210"
  }'
```

---

### 1.2 Verify OTP

Verify OTP and login/register user.

**Endpoint**: `POST /auth/verify-otp`
**Authentication**: None

#### Request Body

```json
{
  "phone": "string (required)",
  "otp": "string (6 digits, required)",
  "name": "string (optional, for new users)",
  "district": "string (optional, for new users)",
  "state": "string (optional, for new users)",
  "medium": "string (optional, 'hindi' or 'english', default: 'english')",
  "referral_code": "string (optional, 5 digits)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "is_new_user": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "message": "Welcome! Please complete your profile",
  "user": {
    "phone": "9876543210",
    "name": "John Doe",
    "district": "Mumbai",
    "state": "Maharashtra",
    "medium": "english",
    "referral_code": "12345",
    "profile_image_url": null,
    "xp_total": 50,
    "current_level": 1,
    "total_ads_watched": 0,
    "date_joined": "2025-11-19T10:30:00.000Z"
  },
  "referral_bonus": {
    "applied": true,
    "xp_granted": 50,
    "message": "Referral bonus: 50 XP granted!"
  }
}
```

#### Error Responses

**400 - Invalid OTP**
```json
{
  "success": false,
  "error": "INVALID_OTP",
  "message": "Incorrect OTP"
}
```

**400 - OTP Expired**
```json
{
  "success": false,
  "error": "OTP_EXPIRED",
  "message": "OTP has expired. Please request a new one"
}
```

**400 - Invalid Referral Code**
```json
{
  "success": false,
  "error": "INVALID_REFERRAL_CODE",
  "message": "Invalid referral code"
}
```

**400 - Self Referral Not Allowed**
```json
{
  "success": false,
  "error": "SELF_REFERRAL_NOT_ALLOWED",
  "message": "You cannot use your own referral code"
}
```

**400 - Already Referred**
```json
{
  "success": false,
  "error": "ALREADY_REFERRED",
  "message": "You have already used a referral code"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210",
    "otp": "123456",
    "name": "John Doe",
    "district": "Mumbai",
    "state": "Maharashtra",
    "referral_code": "98765"
  }'
```

---

### 1.3 Validate Token

Validate JWT token and update user streak.

**Endpoint**: `POST /auth/validate-token`
**Authentication**: Required (JWT in header)

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Request Body

```json
{
  "token": "string (required, same as in header)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "token_valid": true,
  "user": {
    "phone": "9876543210",
    "name": "John Doe",
    "district": "Mumbai",
    "state": "Maharashtra",
    "xp_total": 150,
    "current_level": 2,
    "profile_image_url": "https://minio.example.com/profiles/user123.jpg"
  },
  "streak_updated": true,
  "current_streak": 5
}
```

#### Error Responses

**401 - Invalid Token**
```json
{
  "success": false,
  "error": "TOKEN_INVALID",
  "message": "Invalid token"
}
```

**401 - Token Expired**
```json
{
  "success": false,
  "error": "TOKEN_EXPIRED",
  "message": "Token has expired"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/auth/validate-token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

---

## 2. USER PROFILE APIS

### 2.1 Get User Profile

Get current user's profile with streak information.

**Endpoint**: `GET /user/profile`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "user": {
    "phone": "9876543210",
    "name": "John Doe",
    "district": "Mumbai",
    "state": "Maharashtra",
    "medium": "english",
    "referral_code": "12345",
    "profile_image_url": "https://minio.example.com/profiles/user123.jpg",
    "xp_total": 350,
    "xp_today": 50,
    "current_level": 3,
    "total_ads_watched": 5,
    "date_joined": "2025-11-10T10:30:00.000Z",
    "streak": {
      "current": 7,
      "longest": 12,
      "last_active": "2025-11-19"
    }
  }
}
```

#### Error Responses

**401 - Unauthorized**
```json
{
  "success": false,
  "error": "TOKEN_INVALID",
  "message": "Invalid or missing token"
}
```

**404 - User Not Found**
```json
{
  "success": false,
  "error": "USER_NOT_FOUND",
  "message": "User not found"
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/user/profile \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 2.2 Update User Profile (without image)

Update user profile fields (name, district, state).

**Endpoint**: `PATCH /user/profile`
**Authentication**: Required
**Content-Type**: `application/json`

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "name": "string (optional)",
  "district": "string (optional)",
  "state": "string (optional)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Profile updated successfully",
  "user": {
    "phone": "9876543210",
    "name": "Updated Name",
    "district": "New District",
    "state": "New State",
    "profile_image_url": "https://minio.example.com/profiles/user123.jpg"
  }
}
```

#### Error Responses

**401 - Unauthorized**
```json
{
  "success": false,
  "error": "TOKEN_INVALID",
  "message": "Invalid token"
}
```

#### cURL Example

```bash
curl -X PATCH http://localhost:3000/api/v1/user/profile \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Smith",
    "district": "Delhi",
    "state": "Delhi"
  }'
```

---

### 2.3 Update User Profile (with image)

Update user profile including profile image.

**Endpoint**: `PATCH /user/profile`
**Authentication**: Required
**Content-Type**: `multipart/form-data`

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data
```

#### Request Body (Form Data)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | No | User's name |
| district | string | No | User's district |
| state | string | No | User's state |
| profile_image | file | No | Image file (max 10MB, jpg/png) |

#### Success Response (200)

```json
{
  "success": true,
  "message": "Profile updated successfully",
  "user": {
    "phone": "9876543210",
    "name": "John Smith",
    "district": "Delhi",
    "state": "Delhi",
    "profile_image_url": "https://minio.example.com/profiles/abc123.jpg"
  }
}
```

#### Error Responses

**400 - File Too Large**
```json
{
  "success": false,
  "error": "FILE_TOO_LARGE",
  "message": "Image size must be less than 10MB"
}
```

#### cURL Example

```bash
curl -X PATCH http://localhost:3000/api/v1/user/profile \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -F "name=John Smith" \
  -F "district=Delhi" \
  -F "state=Delhi" \
  -F "profile_image=@/path/to/image.jpg"
```

---

### 2.4 Get Referral Stats

Get user's referral statistics including total referrals and XP earned.

**Endpoint**: `GET /user/referral-stats`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "referral_stats": {
    "my_referral_code": "12345",
    "total_referrals": 15,
    "total_xp_earned_from_referrals": 750,
    "referred_by": {
      "phone": "9876543210",
      "name": "John Doe"
    }
  }
}
```

**If not referred by anyone:**
```json
{
  "success": true,
  "referral_stats": {
    "my_referral_code": "12345",
    "total_referrals": 5,
    "total_xp_earned_from_referrals": 250,
    "referred_by": null
  }
}
```

#### Error Responses

**404 - User Not Found**
```json
{
  "success": false,
  "error": "USER_NOT_FOUND",
  "message": "User not found"
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/user/referral-stats \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 2.5 Get Referred Users

Get paginated list of users referred by current user.

**Endpoint**: `GET /user/referred-users`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| limit | integer | No | 50 | Number of results (1-100) |
| offset | integer | No | 0 | Offset for pagination |

#### Success Response (200)

```json
{
  "success": true,
  "total_referrals": 15,
  "referrals": [
    {
      "referee_phone": "9123456789",
      "referee_name": "Alice",
      "referee_xp": 1250,
      "referee_level": 8,
      "xp_granted": 50,
      "referral_date": "2025-11-15T10:30:00.000Z",
      "status": "active"
    },
    {
      "referee_phone": "9123456790",
      "referee_name": "Bob",
      "referee_xp": 850,
      "referee_level": 5,
      "xp_granted": 50,
      "referral_date": "2025-11-18T14:20:00.000Z",
      "status": "active"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}
```

**If no referrals:**
```json
{
  "success": true,
  "total_referrals": 0,
  "referrals": [],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}
```

#### Error Responses

**400 - Invalid Limit**
```json
{
  "success": false,
  "error": "INVALID_LIMIT",
  "message": "Limit must be between 1 and 100"
}
```

**400 - Invalid Offset**
```json
{
  "success": false,
  "error": "INVALID_OFFSET",
  "message": "Offset must be 0 or greater"
}
```

#### cURL Examples

```bash
# Get first 50 referrals
curl -X GET "http://localhost:3000/api/v1/user/referred-users?limit=50&offset=0" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get next 50 referrals (pagination)
curl -X GET "http://localhost:3000/api/v1/user/referred-users?limit=50&offset=50" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get only 10 referrals
curl -X GET "http://localhost:3000/api/v1/user/referred-users?limit=10&offset=0" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 3. QUIZ/LEVEL APIS

### 3.1 Get Level History

Get user's level completion history.

**Endpoint**: `GET /user/level-history`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "history": [
    {
      "level": 1,
      "attempts": 2,
      "best_accuracy": 90,
      "total_xp_from_level": 100,
      "video_watched": 1
    },
    {
      "level": 2,
      "attempts": 1,
      "best_accuracy": 70,
      "total_xp_from_level": 50,
      "video_watched": 1
    }
  ]
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/user/level-history \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 3.2 Start Level

Start a new level attempt and get questions.

**Endpoint**: `POST /level/start`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "level": "integer (required, must be unlocked)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "attempt_id": 42,
  "level": 1,
  "is_first_attempt": true,
  "xp_per_correct": 5,
  "lifelines_remaining": 3,
  "questions": [
    {
      "sl": 1,
      "question_order": 1,
      "question_text": "What is the capital of India?",
      "question_image_url": "https://minio.example.com/questions/q1.jpg",
      "options": ["Mumbai", "@New Delhi", "Kolkata", "Chennai"],
      "explanation_text": "New Delhi is the capital city of India.",
      "explanation_url": "https://minio.example.com/explanations/e1.jpg",
      "subject": "General Knowledge",
      "topic": "Geography"
    }
    // ... 9 more questions
  ]
}
```

**Note**: The `@` symbol in options indicates the correct answer. Parse it on the client side.

#### Error Responses

**403 - Level Locked**
```json
{
  "success": false,
  "error": "LEVEL_LOCKED",
  "message": "Complete level 1 first to unlock level 2",
  "current_level": 1
}
```

**404 - Questions Not Found**
```json
{
  "success": false,
  "error": "QUESTIONS_NOT_FOUND",
  "message": "No questions found for this level"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/level/start \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "level": 1
  }'
```

---

### 3.3 Answer Question

Submit answer for a question in an active level attempt.

**Endpoint**: `POST /question/answer`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "attempt_id": "integer (required)",
  "question_id": "integer (required, use 'sl' from questions)",
  "user_answer": "integer (required, 1-4)",
  "time_taken_seconds": "integer (optional)"
}
```

#### Success Response (200)

**During Quiz (Questions 1-9):**
```json
{
  "success": true,
  "is_correct": true,
  "correct_answer": 2,
  "explanation_text": "New Delhi is the capital city of India.",
  "explanation_url": "https://minio.example.com/explanations/e1.jpg",
  "progress": {
    "questions_attempted": 5,
    "correct_answers": 4,
    "accuracy_so_far": 80.0
  },
  "lifelines": {
    "remaining": 3,
    "can_continue": true,
    "can_watch_video_to_restore": false
  }
}
```

**On 10th Question (Quiz Complete):**
```json
{
  "success": true,
  "is_correct": true,
  "correct_answer": 2,
  "explanation_text": "Final answer explanation...",
  "explanation_url": null,
  "progress": {
    "questions_attempted": 10,
    "correct_answers": 8,
    "accuracy_so_far": 80.0
  },
  "lifelines": {
    "remaining": 2,
    "can_continue": true,
    "can_watch_video_to_restore": false
  },
  "quiz_completed": true,
  "attempt": {
    "attempt_id": 42,
    "level": 1,
    "completion_status": "completed",
    "correct_answers": 8,
    "accuracy": 80.0,
    "xp_earned_base": 40,
    "is_first_attempt": true,
    "video_watched": false,
    "can_unlock_next_level": true
  }
}
```

#### Error Responses

**404 - Question Not Found**
```json
{
  "success": false,
  "error": "QUESTION_NOT_FOUND",
  "message": "Question not found"
}
```

**404 - Attempt Not Found**
```json
{
  "success": false,
  "error": "ATTEMPT_NOT_FOUND",
  "message": "Level attempt not found"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/question/answer \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "attempt_id": 42,
    "question_id": 1,
    "user_answer": 2,
    "time_taken_seconds": 15
  }'
```

---

### 3.4 Resume Level

Get details of incomplete level attempt to resume.

**Endpoint**: `GET /level/resume`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "has_incomplete_level": true,
  "resume_data": {
    "attempt_id": 42,
    "level": 1,
    "questions_attempted": 5,
    "questions_remaining": 5,
    "lifelines_remaining": 2
  }
}
```

**If no incomplete level:**
```json
{
  "success": true,
  "has_incomplete_level": false
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/level/resume \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 3.5 Abandon Level

Mark current level attempt as abandoned.

**Endpoint**: `POST /level/abandon`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "attempt_id": "integer (required)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Level marked as abandoned"
}
```

#### Error Responses

**404 - Attempt Not Found**
```json
{
  "success": false,
  "error": "ATTEMPT_NOT_FOUND",
  "message": "Level attempt not found"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/level/abandon \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "attempt_id": 42
  }'
```

---

## 4. VIDEO APIS

### 4.1 Get Video URL

Get promotional video for a level.

**Endpoint**: `GET /video/url`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| level | integer | Yes | Level number |
| category | string | No | Filter by category (promotional, shorts, lifeline, tutorial, other) |

#### Success Response (200)

```json
{
  "success": true,
  "video": {
    "id": 5,
    "level": 1,
    "video_name": "Level 1 Introduction Video",
    "video_url": "https://sample-videos.com/video.mp4",
    "duration_seconds": 60,
    "description": "Sample promotional video for level 1",
    "category": "promotional"
  },
  "videos": [
    {
      "id": 5,
      "level": 1,
      "video_name": "Level 1 Introduction Video",
      "video_url": "https://sample-videos.com/video.mp4",
      "duration_seconds": 60,
      "description": "Sample promotional video for level 1",
      "category": "promotional"
    }
  ]
}
```

#### Error Responses

**404 - Video Not Found**
```json
{
  "success": false,
  "error": "VIDEO_NOT_FOUND",
  "message": "No video available for this level"
}
```

#### cURL Examples

```bash
# Get all videos for level 1
curl -X GET "http://localhost:3000/api/v1/video/url?level=1" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get only promotional videos for level 1
curl -X GET "http://localhost:3000/api/v1/video/url?level=1&category=promotional" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 4.2 Complete Video

Mark video as watched and double the XP for the level.

**Endpoint**: `POST /video/complete`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "attempt_id": "integer (required)",
  "video_id": "integer (required)",
  "watch_duration_seconds": "integer (required, must be >= 80% of video duration)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "xp_details": {
    "base_xp": 50,
    "bonus_xp": 50,
    "final_xp": 100,
    "message": "XP doubled!"
  },
  "user_progress": {
    "new_total_xp": 450,
    "new_xp_today": 100,
    "level_unlocked": true,
    "new_current_level": 2
  }
}
```

#### Error Responses

**404 - Video Not Found**
```json
{
  "success": false,
  "error": "VIDEO_NOT_FOUND",
  "message": "Video not found"
}
```

**400 - Insufficient Watch Time**
```json
{
  "success": false,
  "error": "INSUFFICIENT_WATCH_TIME",
  "message": "Watch at least 80% of the video to get bonus XP",
  "watched_percentage": 65.5,
  "required_percentage": 80
}
```

**400 - Video Already Watched**
```json
{
  "success": false,
  "error": "VIDEO_ALREADY_WATCHED",
  "message": "Video already watched for this attempt"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/video/complete \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "attempt_id": 42,
    "video_id": 5,
    "watch_duration_seconds": 50
  }'
```

---

### 4.3 Restore Lifelines

Watch video to restore 3 lifelines during a quiz.

**Endpoint**: `POST /video/restore-lifelines`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "attempt_id": "integer (required)",
  "video_id": "integer (required)",
  "watch_duration_seconds": "integer (required, must be >= 80% of video duration)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "lifelines_restored": true,
  "new_lifelines_remaining": 3,
  "message": "3 lifelines restored! Keep playing!"
}
```

#### Error Responses

**404 - Video Not Found**
```json
{
  "success": false,
  "error": "VIDEO_NOT_FOUND",
  "message": "Video not found"
}
```

**400 - Insufficient Watch Time**
```json
{
  "success": false,
  "error": "INSUFFICIENT_WATCH_TIME",
  "message": "Watch at least 80% of the video to restore lifelines",
  "watched_percentage": 70.0,
  "required_percentage": 80
}
```

**400 - Already Restored**
```json
{
  "success": false,
  "error": "LIFELINES_ALREADY_RESTORED",
  "message": "Lifelines already restored for this attempt"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/video/restore-lifelines \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "attempt_id": 42,
    "video_id": 5,
    "watch_duration_seconds": 50
  }'
```

---

## 5. STATISTICS APIS

### 5.1 Get Daily Leaderboard

Get daily leaderboard showing top 50 users by XP earned today.

**Endpoint**: `GET /leaderboard/daily`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "date": "2025-11-19",
  "user_stats": {
    "rank": 15,
    "name": "John Doe",
    "today_xp": 250
  },
  "top_50": [
    {
      "rank": 1,
      "phone": "9876543210",
      "name": "Top Player",
      "district": "Mumbai",
      "state": "Maharashtra",
      "today_xp": 500,
      "profile_image_url": "https://minio.example.com/profiles/user1.jpg"
    },
    {
      "rank": 2,
      "phone": "9876543211",
      "name": "Second Player",
      "district": "Delhi",
      "state": "Delhi",
      "today_xp": 450,
      "profile_image_url": null
    }
    // ... up to 50 users
  ]
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/leaderboard/daily \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 5.2 Get Daily XP History

Get user's XP earned per day for the last 30 days.

**Endpoint**: `GET /user/daily-xp`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "xp_history": [
    {
      "date": "2025-11-19",
      "total_xp_today": 150,
      "levels_completed_today": 2,
      "videos_watched_today": 2
    },
    {
      "date": "2025-11-18",
      "total_xp_today": 100,
      "levels_completed_today": 1,
      "videos_watched_today": 1
    }
    // ... last 30 days
  ]
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/user/daily-xp \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 5.3 Get User Streak

Get user's current and longest streak.

**Endpoint**: `GET /user/streak`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "streak": {
    "current": 7,
    "longest": 15,
    "last_active": "2025-11-19",
    "message": "7 days streak! 🔥"
  }
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/user/streak \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 5.4 Get User Stats

Get comprehensive user statistics.

**Endpoint**: `GET /user/stats`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "stats": {
    "total_xp": 850,
    "levels_completed": 5,
    "total_attempts": 8,
    "questions_attempted": 80,
    "correct_answers": 68,
    "overall_accuracy": 85.0,
    "videos_watched": 5
  }
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/user/stats \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 6. APP CONFIGURATION APIS

### 6.1 Check App Version

Check if app needs to be updated.

**Endpoint**: `GET /app/version`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "update_required": false,
  "force_update": false,
  "latest_version": "1.0.0",
  "message": "You are using the latest version"
}
```

**If update required:**
```json
{
  "success": true,
  "update_required": true,
  "force_update": false,
  "latest_version": "1.2.0",
  "current_version": "1.0.0",
  "message": "A new version is available. Please update",
  "download_url": "https://play.google.com/store/apps/details?id=com.jnvquiz"
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/app/version \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 6.2 Get Online Users Count

Get number of users currently online/studying.

**Endpoint**: `GET /app/online-count`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "online_users": 182,
  "message": "182 students are studying now!"
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/app/online-count \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 7. REELS APIS *(NEW)*

TikTok/Shorts-style short educational video feed system with engagement tracking.

**Key Concepts:**
- **Started**: User has viewed the reel (appears in feed, now marked as seen)
- **Watched**: User watched >= threshold seconds (configurable, default 5s) - counts for analytics
- **Hearts**: User liked the reel
- **Feed Algorithm**: Newest reels first, excludes already-started reels (sliding window)

### 7.1 Get Reels Feed

Get next batch of reels for the user to watch.

**Endpoint**: `GET /reels/feed`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| limit | integer | No | 3 | Number of reels to fetch (1-10) |

#### Success Response (200)

```json
{
  "success": true,
  "reels": [
    {
      "id": 42,
      "title": "Quick Math Trick for JNV Exam",
      "description": "Learn this amazing multiplication shortcut...",
      "video_url": "https://minio.example.com/quiz/reels/abc123.mp4",
      "thumbnail_url": "https://minio.example.com/quiz/reels/thumb_abc123.jpg",
      "duration_seconds": 45,
      "category": "tips",
      "tags": ["math", "shortcuts", "exam-tips"],
      "total_views": 1250,
      "total_completions": 890,
      "total_hearts": 342,
      "created_at": "2025-11-25T10:30:00.000Z"
    },
    {
      "id": 41,
      "title": "History of Navodaya Vidyalaya",
      "description": "A brief history of JNV schools in India...",
      "video_url": "https://minio.example.com/quiz/reels/def456.mp4",
      "thumbnail_url": null,
      "duration_seconds": 60,
      "category": "education",
      "tags": ["history", "jnv"],
      "total_views": 2100,
      "total_completions": 1800,
      "total_hearts": 567,
      "created_at": "2025-11-24T15:20:00.000Z"
    }
  ],
  "has_more": true,
  "watch_threshold_seconds": 5
}
```

**If no more reels available:**
```json
{
  "success": true,
  "reels": [],
  "has_more": false,
  "watch_threshold_seconds": 5
}
```

#### cURL Example

```bash
curl -X GET "http://localhost:3000/api/v1/reels/feed?limit=3" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 7.2 Get Single Reel

Get details of a specific reel by ID.

**Endpoint**: `GET /reels/:id`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### URL Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | integer | Yes | Reel ID |

#### Success Response (200)

```json
{
  "success": true,
  "reel": {
    "id": 42,
    "title": "Quick Math Trick for JNV Exam",
    "description": "Learn this amazing multiplication shortcut...",
    "video_url": "https://minio.example.com/quiz/reels/abc123.mp4",
    "thumbnail_url": "https://minio.example.com/quiz/reels/thumb_abc123.jpg",
    "duration_seconds": 45,
    "category": "tips",
    "tags": ["math", "shortcuts", "exam-tips"],
    "total_views": 1250,
    "total_completions": 890,
    "total_hearts": 342,
    "is_active": true,
    "created_at": "2025-11-25T10:30:00.000Z"
  },
  "user_progress": {
    "started": true,
    "watched": true,
    "hearted": false,
    "watch_count": 2,
    "total_watch_time_seconds": 90,
    "first_viewed_at": "2025-11-25T12:00:00.000Z",
    "last_viewed_at": "2025-11-25T14:30:00.000Z"
  }
}
```

#### Error Responses

**404 - Reel Not Found**
```json
{
  "success": false,
  "error": "REEL_NOT_FOUND",
  "message": "Reel not found"
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/reels/42 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 7.3 Mark Reel Started

Mark reel as started (viewed) when user scrolls to it. Removes from future feed.

**Endpoint**: `POST /reels/started`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "reel_id": "integer (required)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Reel marked as started",
  "progress": {
    "started": true,
    "watched": false,
    "hearted": false
  }
}
```

**If already started:**
```json
{
  "success": true,
  "message": "Reel already started",
  "progress": {
    "started": true,
    "watched": true,
    "hearted": false
  }
}
```

#### Error Responses

**404 - Reel Not Found**
```json
{
  "success": false,
  "error": "REEL_NOT_FOUND",
  "message": "Reel not found"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/reels/started \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "reel_id": 42
  }'
```

---

### 7.4 Mark Reel Watched

Mark reel as fully watched after watching >= threshold seconds.

**Endpoint**: `POST /reels/watched`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "reel_id": "integer (required)",
  "watch_duration_seconds": "integer (required, must be >= threshold)"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Reel marked as watched",
  "progress": {
    "started": true,
    "watched": true,
    "hearted": false,
    "watch_count": 1,
    "total_watch_time_seconds": 45
  }
}
```

#### Error Responses

**400 - Insufficient Watch Time**
```json
{
  "success": false,
  "error": "INSUFFICIENT_WATCH_TIME",
  "message": "Watch at least 5 seconds to mark as watched",
  "watched_seconds": 3,
  "required_seconds": 5
}
```

**404 - Reel Not Found**
```json
{
  "success": false,
  "error": "REEL_NOT_FOUND",
  "message": "Reel not found"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/reels/watched \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "reel_id": 42,
    "watch_duration_seconds": 45
  }'
```

---

### 7.5 Heart/Unlike Reel

Toggle heart (like) on a reel.

**Endpoint**: `POST /reels/heart`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Request Body

```json
{
  "reel_id": "integer (required)"
}
```

#### Success Response (200)

**When hearting:**
```json
{
  "success": true,
  "action": "hearted",
  "message": "Reel hearted",
  "new_heart_count": 343
}
```

**When removing heart:**
```json
{
  "success": true,
  "action": "unhearted",
  "message": "Heart removed",
  "new_heart_count": 342
}
```

#### Error Responses

**404 - Reel Not Found**
```json
{
  "success": false,
  "error": "REEL_NOT_FOUND",
  "message": "Reel not found"
}
```

#### cURL Example

```bash
curl -X POST http://localhost:3000/api/v1/reels/heart \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "reel_id": 42
  }'
```

---

### 7.6 Get User Reel Stats

Get user's overall reels engagement statistics.

**Endpoint**: `GET /reels/stats`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Success Response (200)

```json
{
  "success": true,
  "stats": {
    "reels_started": 25,
    "reels_watched": 20,
    "reels_hearted": 8,
    "total_watch_time_seconds": 1250,
    "total_watch_time_formatted": "20 min 50 sec",
    "average_watch_time_seconds": 62.5
  }
}
```

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/reels/stats \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 7.7 Get Hearted Reels

Get list of reels the user has hearted (liked).

**Endpoint**: `GET /reels/hearted`
**Authentication**: Required

#### Request Headers

```http
Authorization: Bearer <jwt_token>
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| limit | integer | No | 20 | Number of reels to fetch (1-50) |
| offset | integer | No | 0 | Offset for pagination |

#### Success Response (200)

```json
{
  "success": true,
  "hearted_reels": [
    {
      "id": 42,
      "title": "Quick Math Trick for JNV Exam",
      "video_url": "https://minio.example.com/quiz/reels/abc123.mp4",
      "thumbnail_url": "https://minio.example.com/quiz/reels/thumb_abc123.jpg",
      "duration_seconds": 45,
      "category": "tips",
      "total_hearts": 343,
      "hearted_at": "2025-11-25T14:30:00.000Z"
    },
    {
      "id": 38,
      "title": "GK Facts Every JNV Student Should Know",
      "video_url": "https://minio.example.com/quiz/reels/ghi789.mp4",
      "thumbnail_url": null,
      "duration_seconds": 30,
      "category": "education",
      "total_hearts": 567,
      "hearted_at": "2025-11-24T10:15:00.000Z"
    }
  ],
  "total_hearted": 8,
  "pagination": {
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

#### cURL Example

```bash
curl -X GET "http://localhost:3000/api/v1/reels/hearted?limit=20&offset=0" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 8. QUIZ LEVELS METADATA APIS (UNAUTHENTICATED)

These endpoints allow the Android app to cache quiz level metadata locally without requiring authentication. This enables faster app startup and offline display of level information.

**Key Benefits:**
- No JWT token required
- Client can cache levels and only fetch when version changes
- Reduces authenticated API calls during app launch

### 8.1 Get All Levels

Get all quiz levels with version information for caching.

**Endpoint**: `GET /levels`
**Authentication**: None (Public endpoint)

#### Success Response (200)

```json
{
  "success": true,
  "levels": [
    {
      "level_number": 1,
      "title": "Level 1",
      "subtitle": "Getting Started",
      "duration_seconds": 300
    },
    {
      "level_number": 2,
      "title": "Level 2",
      "subtitle": "Basic Concepts",
      "duration_seconds": 300
    },
    {
      "level_number": 3,
      "title": "Level 3",
      "subtitle": "Building Knowledge",
      "duration_seconds": 300
    }
  ],
  "version": 1,
  "last_updated_at": "2025-11-28T10:30:00.000Z",
  "total_levels": 100
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| levels | array | List of active quiz levels |
| levels[].level_number | integer | Level number (1-100) |
| levels[].title | string | Display title for the level |
| levels[].subtitle | string | Optional subtitle or description |
| levels[].duration_seconds | integer | Time limit for the level in seconds |
| version | integer | Current levels version (increments when levels change) |
| last_updated_at | string | ISO timestamp of last levels update |
| total_levels | integer | Total number of active levels |

#### cURL Example

```bash
curl -X GET http://localhost:3000/api/v1/levels
```

---

### 8.2 Check Levels Update

Check if levels have changed since client's cached version. Use this to avoid downloading full levels list on every app launch.

**Endpoint**: `GET /levels/check`
**Authentication**: None (Public endpoint)

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| version | integer | No | 0 | Client's cached version number |

#### Success Response - No Update Needed (200)

```json
{
  "success": true,
  "changed": false,
  "current_version": 1
}
```

#### Success Response - Update Available (200)

```json
{
  "success": true,
  "changed": true,
  "new_version": 2,
  "last_updated_at": "2025-11-29T10:30:00.000Z",
  "levels": [
    {
      "level_number": 1,
      "title": "Level 1",
      "subtitle": "Getting Started",
      "duration_seconds": 300
    },
    {
      "level_number": 2,
      "title": "Level 2",
      "subtitle": "Basic Concepts",
      "duration_seconds": 300
    }
  ],
  "total_levels": 100
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| changed | boolean | Whether levels have changed since client's version |
| current_version | integer | (Only if changed=false) Current server version |
| new_version | integer | (Only if changed=true) New version to cache |
| last_updated_at | string | (Only if changed=true) Timestamp of update |
| levels | array | (Only if changed=true) Full list of new levels |
| total_levels | integer | (Only if changed=true) Total number of levels |

#### cURL Examples

```bash
# Check with version 0 (first app launch)
curl -X GET "http://localhost:3000/api/v1/levels/check?version=0"

# Check with cached version 1
curl -X GET "http://localhost:3000/api/v1/levels/check?version=1"

# Check with current version (no update)
curl -X GET "http://localhost:3000/api/v1/levels/check?version=2"
```

---

### Levels Caching Strategy (Android Implementation)

```mermaid
sequenceDiagram
    participant App
    participant LocalCache
    participant API

    Note over App: App Launch
    App->>LocalCache: Get cached version
    LocalCache->>App: version=1

    App->>API: GET /levels/check?version=1
    alt No update needed
        API->>App: changed=false
        App->>LocalCache: Use cached levels
    else Update available
        API->>App: changed=true, levels=[...]
        App->>LocalCache: Save new levels + version
        App->>App: Display updated levels
    end
```

**Implementation Notes:**

1. **First Launch**: Call `GET /levels` to fetch all levels, cache them with version
2. **Subsequent Launches**: Call `GET /levels/check?version=X` with cached version
3. **If changed=false**: Use cached levels (no network overhead)
4. **If changed=true**: Update local cache with new levels and version
5. **Offline Mode**: Always display cached levels if available

---

## Common Workflows

### 1. User Registration & First Quiz

```mermaid
sequenceDiagram
    App->>API: POST /auth/send-otp
    API->>App: OTP sent
    App->>API: POST /auth/verify-otp (with name, district, state)
    API->>App: JWT token + user data
    App->>API: POST /level/start (level=1)
    API->>App: attempt_id + 10 questions
    loop For each question
        App->>API: POST /question/answer
        API->>App: is_correct + progress
    end
    App->>API: GET /video/url?level=1
    API->>App: video details
    App->>API: POST /video/complete
    API->>App: XP doubled + level unlocked
```

### 2. Lifeline Restoration Flow

```mermaid
sequenceDiagram
    App->>API: POST /question/answer (wrong answer)
    API->>App: lifelines_remaining=0, can_watch_video_to_restore=true
    App->>API: GET /video/url?level=1&category=lifeline
    API->>App: lifeline restoration video
    App->>API: POST /video/restore-lifelines (after 80% watch)
    API->>App: lifelines_restored=true, new_lifelines_remaining=3
    App->>API: Continue POST /question/answer
```

### 3. Daily Leaderboard Check

```mermaid
sequenceDiagram
    App->>API: POST /auth/validate-token
    API->>App: streak updated
    App->>API: GET /leaderboard/daily
    API->>App: user rank + top 50
    App->>API: GET /user/stats
    API->>App: comprehensive stats
```

### 4. Referral System Flow

```mermaid
sequenceDiagram
    participant User as New User
    participant API
    participant Referrer

    User->>API: POST /auth/send-otp (phone)
    API->>User: OTP sent
    User->>API: POST /auth/verify-otp (with referral_code)
    API->>API: Validate referral code
    API->>API: Check self-referral & duplicate
    API->>API: Grant 50 XP to both users
    API->>API: Log to referral_tracking table
    API->>User: JWT + user data (xp_total=50)
    API->>Referrer: +50 XP (background update)

    Note over User,Referrer: Later: Check referral stats

    Referrer->>API: GET /user/referral-stats
    API->>Referrer: total_referrals + xp_earned
    Referrer->>API: GET /user/referred-users
    API->>Referrer: List of all referred users
```

**Key Points:**
- Referral code is validated before XP is granted
- Self-referral is blocked (user cannot use own code)
- Each user can only be referred once (UNIQUE constraint)
- Both users get 50 XP immediately upon successful referral
- XP is added to both `xp_total` and `daily_xp_summary`
- Referral is logged in `referral_tracking` for analytics

### 5. Reels Viewing Flow *(NEW)*

```mermaid
sequenceDiagram
    participant App
    participant API

    App->>API: GET /reels/feed?limit=3
    API->>App: 3 reels (newest first)

    Note over App: User scrolls to first reel
    App->>API: POST /reels/started (reel_id=42)
    API->>App: Reel marked as started

    Note over App: User watches for 5+ seconds
    App->>API: POST /reels/watched (reel_id=42, watch_duration_seconds=45)
    API->>App: Reel marked as watched

    Note over App: User taps heart button
    App->>API: POST /reels/heart (reel_id=42)
    API->>App: Reel hearted (toggle)

    Note over App: Prefetch more reels
    App->>API: GET /reels/feed?limit=3
    API->>App: Next 3 reels (excludes started ones)
```

**Key Points:**
- Call `started` when reel comes into view (removes from future feed)
- Call `watched` after user watches >= threshold seconds (5s default)
- Feed returns newest reels that user hasn't started yet
- Hearts are toggleable (tap again to remove)
- Prefetch next batch before user reaches last reel in queue

---

## Data Types & Enums

### Video Categories

```
promotional  - Promotional/marketing videos
shorts       - Short educational clips
lifeline     - Videos for lifeline restoration
tutorial     - How-to/tutorial videos
other        - Miscellaneous videos
```

### Completion Status

```
in_progress  - Level attempt ongoing
completed    - Level completed (all 10 questions answered)
abandoned    - User abandoned the level
```

### Difficulty Levels

```
easy    - Easy questions
medium  - Medium difficulty
hard    - Hard questions
```

### Referral Code Format

```
Format: 5-digit numeric code
Range: 10000 - 99999
Example: 12345, 98765
Uniqueness: Each user gets a unique code on signup
Immutability: Code never changes once generated
```

### Referral Status

```
active   - Referral is active and counted
revoked  - Referral has been revoked (future use)
```

### Reel Categories *(NEW)*

```
education   - Educational content
motivation  - Motivational videos
tips        - Tips & tricks for exams
news        - News updates
other       - Miscellaneous content
```

### Language Medium *(NEW)*

**User Preference** (set during signup/profile):
```
english  - Prefer English language questions (default)
hindi    - Prefer Hindi language questions
```

**Question Medium** (set when uploading questions):
```
english  - English-only questions
hindi    - Hindi-only questions
both     - Bilingual questions (shown to all users)
```

**Fallback Logic**: If no questions match user's preferred medium, system falls back to `english` or `both`, then to any available questions.

---

## Notes for Android Development

1. **Token Storage**: Store JWT token securely using Android Keystore or EncryptedSharedPreferences
2. **Token Expiry**: Token is valid for 180 days, but implement refresh logic
3. **Offline Support**: Cache user profile and level data for offline access
4. **Image Loading**: Use libraries like Glide/Coil for loading images from MinIO URLs
5. **Video Player**: Implement ExoPlayer with tracking for 80% watch requirement
6. **Error Handling**: Implement retry logic with exponential backoff for network errors
7. **Rate Limiting**: Implement client-side rate limiting to avoid 429 errors
8. **File Upload**: Use Retrofit with Multipart for profile image upload
9. **Referral Code Input**: Validate 5-digit numeric input before sending to API
10. **Referral Stats**: Show user's referral code prominently for sharing (QR code, share button)
11. **Pagination**: Implement RecyclerView with pagination for referred users list
12. **Deep Linking**: Consider implementing deep links with referral code pre-filled

### Reels Implementation Notes *(NEW)*

13. **Vertical Pager**: Use ViewPager2 with RecyclerView for smooth vertical scrolling like TikTok/Shorts
14. **Prefetch Strategy**: Prefetch next 3 reels when user is 1 reel away from end of current batch
15. **Auto-play on Scroll**: Auto-play video when reel comes into view, pause when scrolling away
16. **Watch Time Tracking**: Track watch duration accurately using ExoPlayer's playback events
17. **Started vs Watched**:
    - Call `POST /reels/started` immediately when reel enters viewport
    - Call `POST /reels/watched` only after 5+ seconds of actual watch time
18. **Heart Animation**: Use LottieFiles or similar for heart animation on tap
19. **Offline Queue**: Queue started/watched/heart API calls if offline, sync when back online
20. **Video Caching**: Use ExoPlayer's cache for smooth playback of prefetched reels
21. **Loop Playback**: Loop reels that are shorter than watch threshold to count views properly

---

**End of Documentation**

For questions or issues, contact the backend development team.
