import { describe, expect, it } from 'vitest';

import {
  buildCloudflareImageResizingApiPath,
  getSessionImageDownloadApiPath,
  getSessionImageThumbnailApiPath,
  isValidSessionImagePathSegment,
  unwrapCloudflareImageResizingApiPath,
} from '../src/session-image';

describe('session-image thumbnail path', () => {
  it('builds a cloudflare image resizing path from source path', () => {
    expect(
      buildCloudflareImageResizingApiPath(
        '/api/workspaces/workspace/session-images/session/image',
        {
          width: 200,
          height: 120,
          fit: 'cover',
          quality: 90,
        }
      )
    ).toBe(
      '/cdn-cgi/image/width=200,height=120,fit=cover,quality=90,format=auto,metadata=none/api/workspaces/workspace/session-images/session/image'
    );
  });

  it('normalizes out-of-range resize options', () => {
    expect(
      buildCloudflareImageResizingApiPath('api/workspaces/ws/session-images/session/image', {
        width: Number.NaN,
        height: 100000,
        quality: 0,
      })
    ).toBe(
      '/cdn-cgi/image/width=512,height=4096,fit=scale-down,quality=1,format=auto,metadata=none/api/workspaces/ws/session-images/session/image'
    );
  });

  it('builds thumbnail path from encoded session image path', () => {
    const downloadPath = getSessionImageDownloadApiPath('workspace id', 'session id', 'image/id');
    expect(downloadPath).toBe(
      '/api/workspaces/workspace%20id/session-images/session%20id/image%2Fid'
    );

    expect(
      getSessionImageThumbnailApiPath('workspace id', 'session id', 'image/id', {
        width: 180,
      })
    ).toBe(
      '/cdn-cgi/image/width=180,fit=scale-down,quality=85,format=auto,metadata=none/api/workspaces/workspace%20id/session-images/session%20id/image%2Fid'
    );
  });

  it('unwraps a cloudflare image resizing path to its source api path', () => {
    expect(
      unwrapCloudflareImageResizingApiPath(
        '/cdn-cgi/image/width=192,height=192,fit=cover,quality=85,format=auto,metadata=none/api/workspaces/workspace/session-images/session/image'
      )
    ).toBe('/api/workspaces/workspace/session-images/session/image');
  });

  it('does not unwrap non-resizing or malformed paths', () => {
    expect(
      unwrapCloudflareImageResizingApiPath('/api/workspaces/workspace/session-images/session/image')
    ).toBeNull();
    expect(unwrapCloudflareImageResizingApiPath('/cdn-cgi/image/')).toBeNull();
    expect(unwrapCloudflareImageResizingApiPath('/cdn-cgi/image/width=192')).toBeNull();
    expect(unwrapCloudflareImageResizingApiPath('/cdn-cgi/image/width=192/')).toBeNull();
  });

  it('validates safe session image path segments', () => {
    expect(isValidSessionImagePathSegment('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidSessionImagePathSegment('img_1-2')).toBe(true);
    expect(isValidSessionImagePathSegment('')).toBe(false);
    expect(isValidSessionImagePathSegment('session id')).toBe(false);
    expect(isValidSessionImagePathSegment('session/id')).toBe(false);
    expect(isValidSessionImagePathSegment('../session')).toBe(false);
    expect(isValidSessionImagePathSegment('x'.repeat(129))).toBe(false);
  });
});
