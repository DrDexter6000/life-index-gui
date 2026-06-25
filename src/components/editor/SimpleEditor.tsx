import { memo, useCallback, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface SimpleEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  minHeight?: string;
  showToolbar?: boolean;
  onFocus?: () => void;
  etherDissolve?: boolean;
}

/**
 * SimpleEditor - 简化版编辑器
 * Plain textarea with character count and basic formatting
 * Will be replaced with TipTap in future
 */
function SimpleEditorComponent({
  content,
  onChange,
  placeholder,
  minHeight = '300px',
  onFocus,
  etherDissolve = false,
}: SimpleEditorProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('editorRecordPlaceholder');
  const [charCount, setCharCount] = useState(content.length);
  const resolvedMinHeight = etherDissolve
    ? `calc(${minHeight} + var(--ether-action-collapse-height, 0px))`
    : minHeight;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    onChange(newContent);
    setCharCount(newContent.length);
  }, [onChange]);

  return (
    <div className="relative">
      <label htmlFor="editor-textarea" className="sr-only">Journal content</label>
      <textarea
        id="editor-textarea"
        value={content}
        onChange={handleChange}
        onFocus={onFocus}
        placeholder={resolvedPlaceholder}
        className={`editor-textarea w-full border-none resize-none outline-none text-[1.125rem] max-sm:text-[1.0rem] leading-[1.85] text-[var(--color-primary)] placeholder:text-[var(--color-secondary)] placeholder:italic pb-8 ${etherDissolve ? 'bg-[var(--color-ether-surface-ghost)]' : 'bg-transparent'}`}
        style={{ fontFamily: 'var(--font-narrative)', minHeight: resolvedMinHeight }}
      />

      {/* Character count — aligned to textarea content bottom */}
      <div
        aria-live="polite"
        className={`absolute right-2 bottom-2 text-xs max-sm:text-[0.7rem] text-[var(--color-secondary)] transition-opacity duration-500 ${
          charCount > 0 ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
      >
        {t('charCount', { count: charCount })}
      </div>
    </div>
  );
}

export const SimpleEditor = memo(SimpleEditorComponent);
