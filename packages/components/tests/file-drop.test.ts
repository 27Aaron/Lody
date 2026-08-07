import { describe, expect, it } from 'vitest';

import { splitImageAndFileAttachments } from '../src/lib/file-drop';

describe('splitImageAndFileAttachments', () => {
  it('keeps images and regular files in their upload lanes', () => {
    const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
    const document = new File(['document'], 'notes.txt', { type: 'text/plain' });

    expect(splitImageAndFileAttachments([image, document])).toEqual({
      images: [image],
      attachments: [document],
    });
  });
});
