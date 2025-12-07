const Minio = require('minio');
require('dotenv').config();

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY
});

// Default bucket (for backward compatibility)
const bucketName = process.env.MINIO_BUCKET;

/**
 * Ensure a bucket exists with public-read policy
 * @param {string} bucket - Bucket name to ensure
 */
async function ensureBucketExists(bucket = bucketName) {
  try {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket, 'us-east-1');
      console.log(`✓ MinIO bucket "${bucket}" created successfully`);

      // Set bucket policy to public-read
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/*`]
          }
        ]
      };
      await minioClient.setBucketPolicy(bucket, JSON.stringify(policy));
      console.log(`✓ MinIO bucket "${bucket}" set to public-read`);
    } else {
      console.log(`✓ MinIO bucket "${bucket}" already exists`);
    }
    return true;
  } catch (err) {
    console.error(`MinIO bucket setup error for "${bucket}":`, err);
    return false;
  }
}

/**
 * Create a new bucket for a tenant app
 * @param {string} appSlug - App slug to use as bucket name
 */
async function createTenantBucket(appSlug) {
  return ensureBucketExists(appSlug);
}

/**
 * Delete a tenant bucket (use with caution!)
 * @param {string} appSlug - App slug / bucket name
 */
async function deleteTenantBucket(appSlug) {
  try {
    // First, remove all objects in the bucket
    const objectsList = [];
    const stream = minioClient.listObjects(appSlug, '', true);

    await new Promise((resolve, reject) => {
      stream.on('data', obj => objectsList.push(obj.name));
      stream.on('error', reject);
      stream.on('end', resolve);
    });

    if (objectsList.length > 0) {
      await minioClient.removeObjects(appSlug, objectsList);
      console.log(`✓ Removed ${objectsList.length} objects from bucket "${appSlug}"`);
    }

    // Then remove the bucket
    await minioClient.removeBucket(appSlug);
    console.log(`✓ MinIO bucket "${appSlug}" deleted`);
    return true;
  } catch (err) {
    console.error(`MinIO bucket delete error for "${appSlug}":`, err);
    return false;
  }
}

/**
 * Check if a bucket exists
 * @param {string} bucket - Bucket name
 */
async function bucketExists(bucket) {
  try {
    return await minioClient.bucketExists(bucket);
  } catch (err) {
    return false;
  }
}

// Ensure default bucket exists on module load (for backward compatibility)
ensureBucketExists();

module.exports = {
  minioClient,
  bucketName,
  ensureBucketExists,
  createTenantBucket,
  deleteTenantBucket,
  bucketExists
};
