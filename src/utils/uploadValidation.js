function startsWith(buffer, bytes) {
  return buffer?.length >= bytes.length && bytes.every((value, index) => buffer[index] === value);
}

export function detectImageExtension(buffer) {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (buffer?.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  const gif = buffer?.subarray(0, 6).toString();
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  return null;
}

export function isSupportedAudio(buffer) {
  if (!buffer?.length) return false;
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return true; // WebM
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString() === 'ftyp') return true; // MP4/M4A
  if (buffer.subarray(0, 4).toString() === 'OggS') return true;
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE') return true;
  if (buffer.subarray(0, 3).toString() === 'ID3') return true;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0; // MPEG audio frame
}

export function mediaFileFilter(kind) {
  return (_req, file, callback) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    const ok = kind === 'image' ? mime.startsWith('image/') : mime.startsWith('audio/');
    if (!ok) {
      const error = new Error(`Unsupported ${kind} upload`);
      error.code = 'UNSUPPORTED_MEDIA_UPLOAD';
      return callback(error);
    }
    callback(null, true);
  };
}

