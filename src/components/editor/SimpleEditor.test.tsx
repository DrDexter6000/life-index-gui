import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SimpleEditor } from './SimpleEditor';

describe('SimpleEditor', () => {
  it('should have a label associated with the textarea', () => {
    render(<SimpleEditor content="" onChange={vi.fn()} />);
    const textarea = screen.getByLabelText('Journal content');
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('should use CSS variable tokens instead of hardcoded hex', () => {
    const { container } = render(<SimpleEditor content="" onChange={vi.fn()} />);
    const html = container.innerHTML;
    expect(html).toContain('var(--color-primary)');
    expect(html).toContain('var(--color-secondary)');
    expect(html).not.toContain('#e8eaf0');
    expect(html).not.toContain('#5a5f6c');
    expect(html).not.toContain('#7a7f8c');
  });

  it('should preserve content value passed as prop', () => {
    const content = 'My draft that survived a failed write';
    render(<SimpleEditor content={content} onChange={vi.fn()} />);
    const textarea = screen.getByLabelText('Journal content');
    expect(textarea).toHaveValue(content);
  });

  it('should call onChange when user types', () => {
    const onChange = vi.fn();
    render(<SimpleEditor content="" onChange={onChange} />);
    const textarea = screen.getByLabelText('Journal content');
    fireEvent.change(textarea, { target: { value: 'new content' } });
    expect(onChange).toHaveBeenCalledWith('new content');
  });

  it('should update displayed value when content prop changes externally', () => {
    const { rerender } = render(
      <SimpleEditor content="initial" onChange={vi.fn()} />,
    );
    const textarea = screen.getByLabelText('Journal content');
    expect(textarea).toHaveValue('initial');

    // Simulate external state change (e.g., draft preserved after error)
    rerender(<SimpleEditor content="preserved content" onChange={vi.fn()} />);
    expect(textarea).toHaveValue('preserved content');
  });
});
