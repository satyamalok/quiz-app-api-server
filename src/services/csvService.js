const csvParser = require('csv-parser');
const { Readable } = require('stream');

/**
 * Parse CSV file and return headers + rows
 * @param {Buffer} fileBuffer - CSV file buffer
 * @returns {Promise<Object>} { headers: [], rows: [] }
 */
async function parseCSV(fileBuffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let headers = [];

    const stream = Readable.from(fileBuffer.toString());

    stream
      .pipe(csvParser())
      .on('headers', (headerList) => {
        headers = headerList;
      })
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', () => {
        resolve({ headers, rows });
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

/**
 * Get available database columns for questions table
 * @returns {Array} Database column options
 */
function getQuestionColumns() {
  return [
    { value: 'level', label: 'Level (1-100)', required: true },
    { value: 'question_order', label: 'Question Order (1-10)', required: true },
    { value: 'question_text', label: 'Question Text', required: false },
    { value: 'question_image_url', label: 'Question Image URL', required: false },
    { value: 'option_1', label: 'Option 1', required: true },
    { value: 'option_2', label: 'Option 2', required: true },
    { value: 'option_3', label: 'Option 3', required: true },
    { value: 'option_4', label: 'Option 4', required: true },
    { value: 'correct_answer', label: 'Correct Answer (1-4)', required: true },
    { value: 'explanation_text', label: 'Explanation Text', required: false },
    { value: 'explanation_url', label: 'Explanation Image URL', required: false },
    { value: 'subject', label: 'Subject', required: false },
    { value: 'topic', label: 'Topic', required: false },
    { value: 'difficulty', label: 'Difficulty', required: false },
    { value: 'medium', label: 'Language Medium (english/hindi/both)', required: false },
    { value: 'skip', label: '-- Skip This Column --', required: false }
  ];
}

/**
 * Map CSV rows to database format
 * @param {Array} rows - CSV rows
 * @param {Object} mapping - Column mapping (csvHeader -> dbColumn)
 * @returns {Array} Mapped rows ready for database insert
 */
function mapRowsToDatabase(rows, mapping) {
  return rows.map(row => {
    const mappedRow = {};

    // Apply mapping
    Object.keys(mapping).forEach(csvHeader => {
      const dbColumn = mapping[csvHeader];
      if (dbColumn && dbColumn !== 'skip') {
        mappedRow[dbColumn] = row[csvHeader];
      }
    });

    // Add @ symbol to correct answer option
    if (mappedRow.correct_answer) {
      const correctIndex = parseInt(mappedRow.correct_answer);
      if (correctIndex >= 1 && correctIndex <= 4) {
        const optionKey = `option_${correctIndex}`;
        if (mappedRow[optionKey] && !mappedRow[optionKey].startsWith('@')) {
          mappedRow[optionKey] = '@' + mappedRow[optionKey];
        }
      }
    }

    // Normalize medium field (default to 'english' if not set or invalid)
    if (mappedRow.medium) {
      const normalizedMedium = mappedRow.medium.toLowerCase().trim();
      if (['english', 'hindi', 'both'].includes(normalizedMedium)) {
        mappedRow.medium = normalizedMedium;
      } else {
        mappedRow.medium = 'english'; // default for invalid values
      }
    }

    return mappedRow;
  });
}

/**
 * Validate mapped rows
 * @param {Array} mappedRows - Rows after mapping
 * @returns {Object} { valid: boolean, errors: [] }
 */
function validateMappedRows(mappedRows) {
  const errors = [];

  mappedRows.forEach((row, index) => {
    const rowNum = index + 1;

    // Required fields
    if (!row.level) {
      errors.push(`Row ${rowNum}: Missing level`);
    } else if (row.level < 1 || row.level > 100) {
      errors.push(`Row ${rowNum}: Level must be between 1-100`);
    }

    if (!row.question_order) {
      errors.push(`Row ${rowNum}: Missing question_order`);
    } else if (row.question_order < 1 || row.question_order > 10) {
      errors.push(`Row ${rowNum}: Question order must be between 1-10`);
    }

    if (!row.question_text) {
      errors.push(`Row ${rowNum}: Missing question_text`);
    }

    // Check all 4 options exist
    for (let i = 1; i <= 4; i++) {
      if (!row[`option_${i}`]) {
        errors.push(`Row ${rowNum}: Missing option_${i}`);
      }
    }

    // Check exactly one option has @ symbol
    const optionsWithAt = [1, 2, 3, 4].filter(i =>
      row[`option_${i}`] && row[`option_${i}`].startsWith('@')
    );

    if (optionsWithAt.length === 0) {
      errors.push(`Row ${rowNum}: No correct answer marked with @`);
    } else if (optionsWithAt.length > 1) {
      errors.push(`Row ${rowNum}: Multiple correct answers marked with @`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  parseCSV,
  getQuestionColumns,
  mapRowsToDatabase,
  validateMappedRows
};
