const { minioClient, bucketName } = require('../config/minio');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

/**
 * Upload file to MinIO
 * @param {Object} file - Multer file object
 * @param {string} folder - Folder name (questions, videos, profiles, explanations, reels)
 * @param {string} bucket - Optional bucket name (for multi-tenancy). Defaults to env MINIO_BUCKET
 * @returns {Promise<Object>} - { fileName, objectName, publicUrl }
 */
async function uploadFile(file, folder, bucket = null) {
  try {
    const targetBucket = bucket || bucketName;

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
      targetBucket,
      objectName,
      file.buffer,
      file.size,
      metaData
    );

    // Generate public URL
    const domain = process.env.PUBLIC_DOMAIN || 'quiz.tsblive.in';
    const publicUrl = `https://${domain}/storage/${targetBucket}/${objectName}`;

    return {
      fileName,
      objectName,
      publicUrl,
      bucket: targetBucket
    };
  } catch (err) {
    console.error('MinIO upload error:', err);
    throw new Error('File upload failed');
  }
}

/**
 * Upload file for a specific tenant
 * @param {Object} file - Multer file object
 * @param {string} folder - Folder name
 * @param {Object} req - Express request with req.tenant
 * @returns {Promise<Object>} - { fileName, objectName, publicUrl }
 */
async function uploadTenantFile(file, folder, req) {
  if (!req.tenant) {
    throw new Error('Tenant context not found');
  }
  return uploadFile(file, folder, req.tenant.bucket);
}

/**
 * Delete file from MinIO
 * @param {string} objectName - Object name in MinIO (e.g., "questions/uuid.jpg")
 * @param {string} bucket - Optional bucket name (for multi-tenancy)
 */
async function deleteFile(objectName, bucket = null) {
  try {
    const targetBucket = bucket || bucketName;
    await minioClient.removeObject(targetBucket, objectName);
    return true;
  } catch (err) {
    console.error('MinIO delete error:', err);
    throw new Error('File deletion failed');
  }
}

/**
 * Delete file for a specific tenant
 * @param {string} objectName - Object name in MinIO
 * @param {Object} req - Express request with req.tenant
 */
async function deleteTenantFile(objectName, req) {
  if (!req.tenant) {
    throw new Error('Tenant context not found');
  }
  return deleteFile(objectName, req.tenant.bucket);
}

module.exports = {
  uploadFile,
  uploadTenantFile,
  deleteFile,
  deleteTenantFile
};
