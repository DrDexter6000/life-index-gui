import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('strips script tags to prevent XSS', () => {
    const xss = '<script>alert("xss")</script>';
    render(<MarkdownRenderer content={xss} />);
    const container = document.querySelector('.prose');
    // No raw <script> tag must survive in the rendered HTML
    expect(container?.innerHTML).not.toContain('<script>');
    expect(container?.innerHTML).not.toContain('</script>');
  });

  it('strips onerror handlers in img tags to prevent XSS', () => {
    const xss = '<img src=x onerror="alert(1)">';
    render(<MarkdownRenderer content={xss} />);
    const container = document.querySelector('.prose');
    // No onerror attribute must survive as an actual HTML attribute
    const imgTags = container?.querySelectorAll('img');
    if (imgTags && imgTags.length > 0) {
      imgTags.forEach((img) => {
        expect(img.getAttribute('onerror')).toBeNull();
      });
    }
    // Also verify no raw <img ... onerror= in innerHTML
    expect(container?.innerHTML).not.toMatch(/<img[^>]*\bonerror\b/i);
  });

  it('renders basic markdown headers correctly', () => {
    render(<MarkdownRenderer content="# Hello" />);
    const h1 = document.querySelector('h1');
    expect(h1).toBeInTheDocument();
    expect(h1?.textContent).toBe('Hello');
  });

  it('renders bold text correctly', () => {
    render(<MarkdownRenderer content="**bold text**" />);
    const strong = document.querySelector('strong');
    expect(strong).toBeInTheDocument();
    expect(strong?.textContent).toBe('bold text');
  });

  it('renders links correctly', () => {
    render(<MarkdownRenderer content="[click me](https://example.com)" />);
    const link = screen.getByText('click me');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://example.com');
  });

  it('sanitizes dangerous links (javascript: URI)', () => {
    render(<MarkdownRenderer content="[evil](javascript:alert(1))" />);
    const link = document.querySelector('a');
    // DOMPurify strips javascript: URIs — either the link is removed or href is cleaned
    if (link) {
      const href = link.getAttribute('href');
      expect(href === null || !/^javascript:/i.test(href)).toBe(true);
    }
  });
});
