import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GlobalOverlay } from './GlobalOverlay';

describe('GlobalOverlay', () => {
  it('dims the decorative background without covering app content or clicks', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/recall']}>
        <GlobalOverlay />
      </MemoryRouter>,
    );

    const overlay = container.firstElementChild;
    expect(overlay).toHaveClass('pointer-events-none');
    expect((overlay as HTMLElement).style.zIndex).toBe('1');
    expect((overlay as HTMLElement).style.backgroundColor).toBe('black');
  });
});
