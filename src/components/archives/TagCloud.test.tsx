import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TagCloud } from './TagCloud';

const mockUseTopicDistribution = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/hooks/useJournals', () => ({
  useTopicDistribution: () => mockUseTopicDistribution(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        tagCloud: 'Tag Cloud',
        tagCloudEn: 'Tag Cloud',
        loadingData: 'Loading...',
        noData: 'No Data',
      };
      return map[key] ?? key;
    },
  }),
}));

function renderTagCloud() {
  return render(
    <MemoryRouter>
      <TagCloud />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseTopicDistribution.mockReturnValue({
    data: [
      { name: 'alpha', count: 12 },
      { name: 'beta', count: 4 },
      { name: 'gamma', count: 1 },
    ],
    isLoading: false,
  });
});

describe('TagCloud', () => {
  it('renders weighted topic buttons without the ECharts wordcloud extension', () => {
    renderTagCloud();

    const alpha = screen.getByRole('button', { name: 'alpha' });
    const beta = screen.getByRole('button', { name: 'beta' });

    expect(alpha).toHaveStyle({ color: 'var(--color-gold)' });
    expect(alpha).toHaveAttribute('title', 'alpha: 12');
    expect(Number.parseFloat(alpha.style.fontSize)).toBeGreaterThan(
      Number.parseFloat(beta.style.fontSize),
    );
  });

  it('navigates to Recall search when a topic is clicked', () => {
    renderTagCloud();

    fireEvent.click(screen.getByRole('button', { name: 'beta' }));

    expect(mockNavigate).toHaveBeenCalledWith('/recall?q=beta');
  });

  it('renders no-data state when there are no topics', () => {
    mockUseTopicDistribution.mockReturnValue({ data: [], isLoading: false });

    renderTagCloud();

    expect(screen.getByText('No Data')).toBeInTheDocument();
  });
});
