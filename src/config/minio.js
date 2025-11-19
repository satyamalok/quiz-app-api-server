const Minio = require('minio');
require('dotenv').config();

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY
});

// Check if bucket exists, if not create it
const bucketName = process.env.MINIO_BUCKET;

async function ensureBucketExists() {
  try {
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(bucketName, 'us-east-1');
      console.log(`✓ MinIO bucket "${bucketName}" created successfully`);

      // Set bucket policy to public-read
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`]
          }
        ]
      };
      await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
      console.log(`✓ MinIO bucket "${bucketName}" set to public-read`);
    } else {
      console.log(`✓ MinIO bucket "${bucketName}" already exists`);
    }
  } catch (err) {
    console.error('MinIO bucket setup error:', err);
  }
}

// Call on module load
ensureBucketExists();

module.exports = { minioClient, bucketName };
