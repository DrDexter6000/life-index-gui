import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FacetTopN } from './FacetTopN';

describe('FacetTopN presenter', () => {
  it.each([
    ['topics', 'Top topics', 'Planning', 3],
    ['tags', 'Top tags', 'focus', 2],
    ['people', 'Top people', 'Ada', 4],
  ] as const)('renders %s values as read-only labels with counts', (facet, title, value, count) => {
    render(
      <MemoryRouter>
        <FacetTopN
          facet={facet}
          title={title}
          items={[{ value, count }]}
          emptyLabel="Empty"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(value)).toBeInTheDocument();
    expect(screen.getByTestId(`archives-facet-${facet}-count-${value}`)).toHaveTextContent(String(count));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/relationship|graph edge/i)).not.toBeInTheDocument();
  });
});
