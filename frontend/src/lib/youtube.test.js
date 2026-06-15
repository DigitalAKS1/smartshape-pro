import { youtubeId, youtubeEmbedUrl } from './youtube';

test('parses watch URLs', () => {
  expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
});
test('parses youtu.be URLs with params', () => {
  expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
});
test('parses shorts and embed', () => {
  expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
});
test('returns null for non-youtube', () => {
  expect(youtubeId('https://vimeo.com/1')).toBeNull();
  expect(youtubeId('')).toBeNull();
});
test('builds embed url', () => {
  expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  expect(youtubeEmbedUrl('bad')).toBeNull();
});
