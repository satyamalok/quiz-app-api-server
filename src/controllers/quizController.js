const pool = require('../config/database');
const { calculateBaseXP, calculateAccuracy, addXPToUser } = require('../services/xpService');
const { deductLifeline, getLifelineStatus } = require('../services/lifelineService');
const { SQL_IST_NOW, SQL_IST_DATE, SQL_IST_TIME } = require('../utils/timezone');

/**
 * GET /api/v1/user/level-history
 * Get user's level completion history
 */
async function getLevelHistory(req, res, next) {
  try {
    const { phone } = req.user;

    const result = await pool.query(`
      SELECT
        level,
        COUNT(*) as attempts,
        MAX(accuracy_percentage) as best_accuracy,
        SUM(xp_earned_final) as total_xp_from_level,
        MAX(CASE WHEN video_watched = TRUE THEN 1 ELSE 0 END) as video_watched
      FROM level_attempts
      WHERE phone = $1
      GROUP BY level
      ORDER BY level ASC
    `, [phone]);

    res.json({
      success: true,
      history: result.rows
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/level/start
 * Start a new level attempt
 */
async function startLevel(req, res, next) {
  try {
    const { phone } = req.user;
    const { level } = req.body;

    // Check if level is unlocked and get user's medium preference
    const userResult = await pool.query(
      'SELECT current_level, medium FROM users_profile WHERE phone = $1',
      [phone]
    );

    if (userResult.rows.length === 0) {
      throw { code: 'USER_NOT_FOUND', message: 'User not found' };
    }

    const currentLevel = userResult.rows[0].current_level;
    const userMedium = userResult.rows[0].medium || 'english';

    if (level > currentLevel) {
      throw {
        code: 'LEVEL_LOCKED',
        message: `Complete level ${currentLevel} first to unlock level ${level}`,
        current_level: currentLevel
      };
    }

    // Check if this is first attempt (exclude abandoned attempts)
    const attemptCountResult = await pool.query(
      'SELECT COUNT(*) as count FROM level_attempts WHERE phone = $1 AND level = $2 AND completion_status != $3',
      [phone, level, 'abandoned']
    );

    const isFirstAttempt = parseInt(attemptCountResult.rows[0].count) === 0;

    // Fetch 10 questions for this level matching user's medium
    // Priority: user's medium or 'both' > fallback to 'english' or 'both' > fallback to any
    let questionsResult = await pool.query(`
      SELECT
        sl, level, question_order,
        question_text, question_image_url,
        option_1, option_2, option_3, option_4,
        explanation_text, explanation_url,
        subject, topic, medium
      FROM questions
      WHERE level = $1 AND (medium = $2 OR medium = 'both')
      ORDER BY question_order ASC
    `, [level, userMedium]);

    // Fallback 1: If no questions found, try 'english' or 'both'
    if (questionsResult.rows.length === 0 && userMedium !== 'english') {
      questionsResult = await pool.query(`
        SELECT
          sl, level, question_order,
          question_text, question_image_url,
          option_1, option_2, option_3, option_4,
          explanation_text, explanation_url,
          subject, topic, medium
        FROM questions
        WHERE level = $1 AND (medium = 'english' OR medium = 'both')
        ORDER BY question_order ASC
      `, [level]);
    }

    // Fallback 2: If still no questions, get any questions for this level
    if (questionsResult.rows.length === 0) {
      questionsResult = await pool.query(`
        SELECT
          sl, level, question_order,
          question_text, question_image_url,
          option_1, option_2, option_3, option_4,
          explanation_text, explanation_url,
          subject, topic, medium
        FROM questions
        WHERE level = $1
        ORDER BY question_order ASC
      `, [level]);
    }

    if (questionsResult.rows.length === 0) {
      throw { code: 'QUESTIONS_NOT_FOUND', message: 'No questions found for this level' };
    }

    // Create level attempt record with IST timestamps
    const attemptResult = await pool.query(`
      INSERT INTO level_attempts (
        phone, level, is_first_attempt, lifelines_remaining, completion_status,
        attempt_date, attempt_time, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 3, 'in_progress',
        ${SQL_IST_DATE}, ${SQL_IST_TIME}, ${SQL_IST_NOW}, ${SQL_IST_NOW}
      ) RETURNING id
    `, [phone, level, isFirstAttempt]);

    const attemptId = attemptResult.rows[0].id;

    // Format questions for response (with @ symbol intact)
    const questions = questionsResult.rows.map(q => ({
      sl: q.sl,
      question_order: q.question_order,
      question_text: q.question_text,
      question_image_url: q.question_image_url,
      options: [q.option_1, q.option_2, q.option_3, q.option_4],
      explanation_text: q.explanation_text,
      explanation_url: q.explanation_url,
      subject: q.subject,
      topic: q.topic
    }));

    res.json({
      success: true,
      attempt_id: attemptId,
      level,
      is_first_attempt: isFirstAttempt,
      xp_per_correct: isFirstAttempt ? 5 : 1,
      lifelines_remaining: 3,
      questions
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/question/answer
 * Submit answer for a question
 */
async function answerQuestion(req, res, next) {
  const client = await pool.connect();

  try {
    const { phone } = req.user;
    const { attempt_id, question_id, user_answer, time_taken_seconds } = req.body;

    await client.query('BEGIN');

    // Get question details
    const questionResult = await client.query(
      'SELECT sl, level, option_1, option_2, option_3, option_4, explanation_text, explanation_url FROM questions WHERE sl = $1',
      [question_id]
    );

    if (questionResult.rows.length === 0) {
      throw { code: 'QUESTION_NOT_FOUND', message: 'Question not found' };
    }

    const question = questionResult.rows[0];
    const options = [question.option_1, question.option_2, question.option_3, question.option_4];

    // Find correct answer (option with @ prefix)
    const correctIndex = options.findIndex(opt => opt.startsWith('@')) + 1; // 1-indexed
    const isCorrect = (user_answer === correctIndex);

    // Insert answer record with IST timestamp
    await client.query(`
      INSERT INTO question_responses (
        attempt_id, phone, question_id, level,
        user_answer, is_correct, time_taken_seconds, answered_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, ${SQL_IST_NOW}, ${SQL_IST_NOW}
      )
    `, [attempt_id, phone, question_id, question.level, user_answer, isCorrect, time_taken_seconds || null]);

    // Update attempt progress with IST timestamp
    await client.query(`
      UPDATE level_attempts
      SET
        questions_attempted = questions_attempted + 1,
        correct_answers = CASE WHEN $1 THEN correct_answers + 1 ELSE correct_answers END,
        accuracy_percentage = CASE
          WHEN questions_attempted + 1 > 0
          THEN ROUND(((correct_answers + CASE WHEN $1 THEN 1 ELSE 0 END)::numeric / (questions_attempted + 1)) * 100, 2)
          ELSE 0
        END,
        updated_at = ${SQL_IST_NOW}
      WHERE id = $2
    `, [isCorrect, attempt_id]);

    // Deduct lifeline if incorrect (pass client to reuse transaction)
    let lifelineStatus = null;
    if (!isCorrect) {
      lifelineStatus = await deductLifeline(attempt_id, client);
    } else {
      lifelineStatus = await getLifelineStatus(attempt_id, client);
    }

    // Get updated attempt progress
    const attemptResult = await client.query(
      'SELECT questions_attempted, correct_answers, accuracy_percentage, lifelines_remaining FROM level_attempts WHERE id = $1',
      [attempt_id]
    );

    const attempt = attemptResult.rows[0];

    // Initialize quiz completion response data
    let quizCompleted = false;
    let levelUnlocked = false;
    let newCurrentLevel = null;
    let baseXP = 0;

    // Auto-complete quiz when all 10 questions answered
    if (attempt.questions_attempted === 10) {
      quizCompleted = true;

      // Get attempt details for XP calculation
      const attemptDetails = await client.query(
        'SELECT is_first_attempt, level, accuracy_percentage FROM level_attempts WHERE id = $1',
        [attempt_id]
      );

      const attemptData = attemptDetails.rows[0];
      baseXP = calculateBaseXP(attempt.correct_answers, attemptData.is_first_attempt);

      // Mark level as completed and store base XP with IST timestamp
      await client.query(`
        UPDATE level_attempts
        SET xp_earned_base = $1, completion_status = 'completed', updated_at = ${SQL_IST_NOW}
        WHERE id = $2
      `, [baseXP, attempt_id]);

      // Add base XP to user's total and daily summary
      await addXPToUser(phone, baseXP, client);

      // Check level unlock (30% accuracy required)
      if (attempt.accuracy_percentage >= 30) {
        const nextLevel = attemptData.level + 1;

        if (nextLevel <= 100) {
          const userResult = await client.query(
            'SELECT current_level FROM users_profile WHERE phone = $1',
            [phone]
          );

          const currentLevel = userResult.rows[0].current_level;

          if (nextLevel > currentLevel) {
            await client.query(
              `UPDATE users_profile SET current_level = $1, updated_at = ${SQL_IST_NOW} WHERE phone = $2`,
              [nextLevel, phone]
            );

            levelUnlocked = true;
            newCurrentLevel = nextLevel;
          }
        }
      }
    }

    await client.query('COMMIT');

    // Build response
    const response = {
      success: true,
      is_correct: isCorrect,
      correct_answer: correctIndex,
      explanation_text: question.explanation_text,
      explanation_url: question.explanation_url,
      progress: {
        questions_attempted: attempt.questions_attempted,
        correct_answers: attempt.correct_answers,
        accuracy_so_far: parseFloat(attempt.accuracy_percentage)
      },
      lifelines: {
        remaining: lifelineStatus.lifelines_remaining,
        can_continue: lifelineStatus.can_continue,
        can_watch_video_to_restore: lifelineStatus.can_watch_video && lifelineStatus.lifelines_remaining === 0
      }
    };

    // Add quiz completion details if quiz is completed
    if (quizCompleted) {
      response.quiz_completed = true;
      response.quiz_result = {
        base_xp_earned: baseXP,
        potential_bonus_xp: baseXP, // Same as base (doubles XP)
        level_unlocked: levelUnlocked,
        ...(levelUnlocked && { new_current_level: newCurrentLevel }),
        can_watch_video_to_double_xp: true,
        message: levelUnlocked
          ? `Level completed! Watch video to double your ${baseXP} XP.`
          : `Quiz completed with ${attempt.accuracy_percentage}% accuracy. Watch video to double your ${baseXP} XP.`
      };
    }

    res.json(response);

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /api/v1/level/abandon
 * Mark level as abandoned
 */
async function abandonLevel(req, res, next) {
  try {
    const { phone } = req.user;
    const { attempt_id } = req.body;

    await pool.query(`
      UPDATE level_attempts
      SET
        completion_status = 'abandoned',
        updated_at = ${SQL_IST_NOW}
      WHERE id = $1 AND phone = $2
    `, [attempt_id, phone]);

    res.json({
      success: true,
      message: 'Level marked as abandoned'
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLevelHistory,
  startLevel,
  answerQuestion,
  abandonLevel
};
