import { describe, expect, it } from 'vitest';
import { attachmentUrl } from './attachments';

describe('attachmentUrl', () => {
  it('strips leading /attachments/ prefix and encodes segments', () => {
    expect(attachmentUrl('/attachments/2026/01/photo.jpg')).toBe(
      '/api/attachments/2026/01/photo.jpg',
    );
  });

  it('strips leading attachments/ prefix without leading slash', () => {
    expect(attachmentUrl('attachments/2026/01/photo.jpg')).toBe(
      '/api/attachments/2026/01/photo.jpg',
    );
  });

  it('handles plain relative path without prefix', () => {
    expect(attachmentUrl('2026/01/photo.jpg')).toBe(
      '/api/attachments/2026/01/photo.jpg',
    );
  });

  it('encodes CJK characters in path segments', () => {
    expect(attachmentUrl('attachments/2026/01/照片.jpg')).toBe(
      '/api/attachments/2026/01/%E7%85%A7%E7%89%87.jpg',
    );
  });

  it('encodes special characters in path segments', () => {
    expect(attachmentUrl('attachments/2026/01/my file@2x.png')).toBe(
      '/api/attachments/2026/01/my%20file%402x.png',
    );
  });

  it('handles relative paths with ../../../attachments/', () => {
    expect(attachmentUrl('../../../attachments/2026/01/photo.jpg')).toBe(
      '/api/attachments/2026/01/photo.jpg',
    );
  });

  it('adds thumbnail variant parameters when requested', () => {
    expect(attachmentUrl('attachments/2026/01/photo.jpg', { variant: 'thumbnail', maxPx: 160 })).toBe(
      '/api/attachments/2026/01/photo.jpg?variant=thumbnail&max_px=160',
    );
  });

  it('adds preview variant parameters when requested', () => {
    expect(attachmentUrl('attachments/2026/01/photo.jpg', { variant: 'preview', maxPx: 1400 })).toBe(
      '/api/attachments/2026/01/photo.jpg?variant=preview&max_px=1400',
    );
  });

  it('passes through full http URLs unchanged', () => {
    expect(attachmentUrl('https://example.com/image.png')).toBe(
      'https://example.com/image.png',
    );
  });

  it('passes through full https URLs unchanged', () => {
    expect(attachmentUrl('http://localhost:8000/static/img.png')).toBe(
      'http://localhost:8000/static/img.png',
    );
  });
});
