import DOMPurify from 'dompurify';
import { attachmentUrl } from '@/lib/attachments';

interface MarkdownRendererProps {
  content: string;
}

/**
 * MarkdownRenderer — 简化版 Markdown 渲染器
 * Supports headings, emphasis, links, images, code, lists, blockquotes.
 * Attachment links are rewritten to use the download API endpoint.
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const parseMarkdown = (text: string): string => {
    let html = text
      // Escape HTML entities
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Images (must come before links)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
        const resolved = attachmentUrl(url);
        return `<img src="${resolved}" alt="${alt}" class="rounded-xl max-w-full my-4 border border-white/[0.06]" loading="lazy" />`;
      })
      // Headers
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-5 mb-2" style="color: var(--color-primary)">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-7 mb-3" style="color: var(--color-primary)">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-8 mb-4 pb-2 border-b border-white/[0.06]" style="color: var(--color-primary)">$1</h1>')
      // Bold and italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--color-gold)">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      // Code blocks
      .replace(/```([\s\S]*?)```/g, '<pre class="border border-white/[0.06] rounded-xl p-4 overflow-x-auto my-4 text-sm" style="background: var(--color-void)"><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-[var(--color-ether-control)] rounded text-sm" style="color: var(--color-gold)">$1</code>')
      // Blockquotes
      .replace(/^&gt; (.*$)/gim, '<blockquote class="border-l-4 pl-4 py-1 my-4 bg-[var(--color-ether-surface-ghost)] rounded-r-lg italic" style="border-left-color: var(--color-gold); color: var(--color-muted)">$1</blockquote>')
      // Links — detect attachments and add download styling
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
        const resolved = attachmentUrl(url);
        const isAttachment = resolved.startsWith('/api/attachments/');
        const isExternal = url.startsWith('http://') || url.startsWith('https://');
        const icon = isAttachment
          ? '<span class="material-symbols-outlined text-sm mr-1 align-text-bottom">download</span>'
          : isExternal
            ? '<span class="material-symbols-outlined text-sm mr-1 align-text-bottom">open_in_new</span>'
            : '';
        const downloadAttr = isAttachment ? ' download' : '';
        return `<a href="${resolved}" class="hover:text-[var(--color-gold)] transition-colors underline underline-offset-2 inline-flex items-center" style="color: var(--color-cyan)" ${isExternal || isAttachment ? 'target="_blank" rel="noopener noreferrer"' : ''}${downloadAttr}>${icon}${label}</a>`;
      })
      // Horizontal rule
      .replace(/^---$/gim, '<hr class="border-white/[0.06] my-8" />')
      // Lists
      .replace(/^- (.*$)/gim, '<li class="ml-4" style="color: var(--color-primary)">$1</li>')
      .replace(/(<li.*<\/li>\n?)+/g, '<ul class="list-disc list-inside mb-4 space-y-1" style="color: var(--color-primary)">$&</ul>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p class="leading-[1.8] mb-5 text-[0.9375rem]" style="color: var(--color-primary); font-family: var(--font-narrative)">')
      // Line breaks
      .replace(/\n/g, '<br />');

    // Wrap in paragraph if not already wrapped
    if (!html.startsWith('<')) {
      html = '<p class="leading-[1.8] mb-5 text-[0.9375rem]" style="color: var(--color-primary); font-family: var(--font-narrative)">' + html + '</p>';
    }

    return html;
  };

  return (
    <div
      className="prose prose-invert max-w-none journal-content"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(parseMarkdown(content)) }}
    />
  );
}
