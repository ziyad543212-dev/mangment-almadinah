const path = require('path');

function getUploadDirectory() {
  const configuredDirectory = process.env.UPLOAD_DIR ||
    path.join(process.env.DATA_DIR || path.resolve(__dirname, '..'), 'uploads');
  return path.resolve(configuredDirectory);
}

module.exports = { getUploadDirectory };
