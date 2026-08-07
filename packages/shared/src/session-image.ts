import {
  SESSION_IMAGE_ALLOWED_EXTENSIONS,
  SESSION_IMAGE_ALLOWED_MIME_TYPES,
  SESSION_IMAGE_MAX_COUNT,
  SESSION_IMAGE_MAX_SIZE_BYTES,
} from './ai';

export {
  SESSION_IMAGE_ALLOWED_EXTENSIONS,
  SESSION_IMAGE_ALLOWED_MIME_TYPES,
  SESSION_IMAGE_MAX_COUNT,
  SESSION_IMAGE_MAX_SIZE_BYTES,
};

export const WORKSPACE_API_PATH_PREFIX = '/api/workspaces';
export const SESSION_IMAGE_UPLOAD_API_PATH = '/session-images/upload';
export const SESSION_IMAGE_OBJECT_PREFIX = 'session-images';
export const SESSION_IMAGE_DOWNLOAD_CACHE_CONTROL = 'private, max-age=31536000, immutable';
export const CLOUDFLARE_IMAGE_RESIZING_API_PATH_PREFIX = '/cdn-cgi/image/';
export const SESSION_IMAGE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_IMAGE_RESIZE_MIN_DIMENSION = 16;
const SESSION_IMAGE_RESIZE_MAX_DIMENSION = 4096;
const SESSION_IMAGE_RESIZE_DEFAULT_WIDTH = 512;
const SESSION_IMAGE_RESIZE_MIN_QUALITY = 1;
const SESSION_IMAGE_RESIZE_MAX_QUALITY = 100;
const SESSION_IMAGE_RESIZE_DEFAULT_QUALITY = 85;

export type SessionImageResizeFit = 'cover' | 'contain' | 'scale-down';
export type SessionImageThumbnailOptions = {
  width: number;
  height?: number;
  fit?: SessionImageResizeFit;
  quality?: number;
};

const trimTrailingSlash = (url: string): string => {
  if (!url.endsWith('/')) {
    return url;
  }
  return url.slice(0, -1);
};

const clampRoundedNumber = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, Math.round(value)));
};

const normalizeResizeDimension = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return clampRoundedNumber(
    value,
    SESSION_IMAGE_RESIZE_MIN_DIMENSION,
    SESSION_IMAGE_RESIZE_MAX_DIMENSION
  );
};

const normalizeResizeQuality = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return SESSION_IMAGE_RESIZE_DEFAULT_QUALITY;
  }
  return clampRoundedNumber(
    value,
    SESSION_IMAGE_RESIZE_MIN_QUALITY,
    SESSION_IMAGE_RESIZE_MAX_QUALITY
  );
};

const normalizeResizeFit = (fit: SessionImageResizeFit | undefined): SessionImageResizeFit => {
  if (fit === 'cover' || fit === 'contain' || fit === 'scale-down') {
    return fit;
  }
  return 'scale-down';
};

const normalizeSourceImagePath = (sourceImagePath: string): string => {
  if (sourceImagePath.startsWith('/')) {
    return sourceImagePath;
  }
  return `/${sourceImagePath}`;
};

export const isValidSessionImagePathSegment = (value: string): boolean => {
  return SESSION_IMAGE_PATH_SEGMENT_PATTERN.test(value);
};

export const getSessionImageUploadApiPath = (workspaceId: string): string => {
  return `${WORKSPACE_API_PATH_PREFIX}/${encodeURIComponent(workspaceId)}${SESSION_IMAGE_UPLOAD_API_PATH}`;
};

export const getSessionImageDownloadApiPath = (
  workspaceId: string,
  sessionId: string,
  imageId: string
): string => {
  return `${WORKSPACE_API_PATH_PREFIX}/${encodeURIComponent(
    workspaceId
  )}/session-images/${encodeURIComponent(sessionId)}/${encodeURIComponent(imageId)}`;
};

export const buildSessionImageApiUrl = (apiBaseUrl: string, apiPath: string): string => {
  return `${trimTrailingSlash(apiBaseUrl)}${apiPath}`;
};

export const buildCloudflareImageResizingApiPath = (
  sourceImagePath: string,
  options: SessionImageThumbnailOptions
): string => {
  const width = normalizeResizeDimension(options.width, SESSION_IMAGE_RESIZE_DEFAULT_WIDTH);
  const height =
    typeof options.height === 'number'
      ? normalizeResizeDimension(options.height, width)
      : undefined;
  const fit = normalizeResizeFit(options.fit);
  const quality = normalizeResizeQuality(options.quality);

  const directives = [
    `width=${width}`,
    ...(height !== undefined ? [`height=${height}`] : []),
    `fit=${fit}`,
    `quality=${quality}`,
    'format=auto',
    'metadata=none',
  ];

  return `${CLOUDFLARE_IMAGE_RESIZING_API_PATH_PREFIX}${directives.join(',')}${normalizeSourceImagePath(sourceImagePath)}`;
};

export const unwrapCloudflareImageResizingApiPath = (apiPath: string): string | null => {
  if (!apiPath.startsWith(CLOUDFLARE_IMAGE_RESIZING_API_PATH_PREFIX)) {
    return null;
  }

  const remainder = apiPath.slice(CLOUDFLARE_IMAGE_RESIZING_API_PATH_PREFIX.length);
  const sourcePathStartIndex = remainder.indexOf('/');
  if (sourcePathStartIndex <= 0) {
    return null;
  }

  const sourcePath = remainder.slice(sourcePathStartIndex);
  return sourcePath === '/' ? null : sourcePath;
};

export const getSessionImageThumbnailApiPath = (
  workspaceId: string,
  sessionId: string,
  imageId: string,
  options: SessionImageThumbnailOptions
): string => {
  const sourcePath = getSessionImageDownloadApiPath(workspaceId, sessionId, imageId);
  return buildCloudflareImageResizingApiPath(sourcePath, options);
};

export const buildSessionImageObjectKey = (
  workspaceId: string,
  sessionId: string,
  imageId: string
): string => {
  return `${SESSION_IMAGE_OBJECT_PREFIX}/${workspaceId}/${sessionId}/${imageId}`;
};
