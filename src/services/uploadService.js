const { minioClient, bucketName } = require('../config/minio');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

/**
 * Upload file to MinIO
 * @param {Object} file - Multer file object
 * @param {string} folder - Folder name (questions, videos, profiles, explanations)
 * @returns {Promise<Object>} - { fileName, publicUrl }
 */
async function uploadFile(file, folder) {
  try {
    // Generate random UUID filename
    const ext = path.extname(file.originalname);
    const fileName = `${uuidv4()}${ext}`;
    const objectName = `${folder}/${fileName}`;

    // Determine content type
    const metaData = {
      'Content-Type': file.mimetype
    };

    // Upload to MinIO
    await minioClient.putObject(
      bucketName,
      objectName,
      file.buffer,
      file.size,
      metaData
    );

    // Generate public URL
    const publicUrl = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${bucketName}/${objectName}`;

    return {
      fileName,
      objectName,
      publicUrl
    };
  } catch (err) {
    console.error('MinIO upload error:', err);
    throw new Error('File upload failed');
  }
}

/**
 * Delete file from MinIO
 * @param {string} objectName - Object name in MinIO (e.g., "questions/uuid.jpg")
 */
async function deleteFile(objectName) {
  try {
    await minioClient.removeObject(bucketName, objectName);
    return true;
  } catch (err) {
    console.error('MinIO delete error:', err);
    throw new Error('File deletion failed');
  }
}

module.exports = {
  uploadFile,
  deleteFile
};
