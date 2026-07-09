import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PeopleGraph } from './PeopleGraph';

const mockUseEntityList = vi.fn();
const mockUseEntityCandidateEdges = vi.fn();
const mockNavigate = vi.fn();

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="people-graph-chart" />,
}));

vi.mock('@/hooks/useJournals', () => ({
  useEntityList: (type: string) => mockUseEntityList(type),
  useEntityCandidateEdges: (limit: number) => mockUseEntityCandidateEdges(limit),
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
        peopleGraph: 'People Graph',
        peopleGraphEn: 'People Graph',
        loadingData: 'Loading...',
        noData: 'No Data',
        peopleGraphLowData: 'More journal entries will reveal your constellation of connections',
        peopleGraphLowDataHint: 'Keep writing — your people graph will appear here.',
        peopleGraphConfirmedPending: 'Relationship graph will appear after confirmed relationships are available.',
        peopleGraphConfirmedPendingHint: 'Candidate edges stay in review and are not shown as relationships.',
        journalCount: '{{count}} entries',
      };
      return map[key] ?? key;
    },
    lang: 'en',
  }),
}));

function renderPeopleGraph() {
  return render(
    <MemoryRouter>
      <PeopleGraph />
    </MemoryRouter>,
  );
}

function makePerson(id: string, name: string, aliases?: string[]) {
  return {
    id,
    type: 'person' as const,
    primary_name: name,
    aliases: aliases ?? [],
    attributes: {},
    relationships: [],
  };
}

const defaultList = {
  data: [] as ReturnType<typeof makePerson>[],
  isLoading: false,
  isError: false,
};

const defaultEdges = {
  data: { candidates: [] as Array<{ source_id: string; target_id: string; weight: number }>, total: 0 },
  isLoading: false,
  isError: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseEntityList.mockReturnValue({ ...defaultList });
  mockUseEntityCandidateEdges.mockReturnValue({ ...defaultEdges });
});

describe('PeopleGraph', () => {
  it('shows a confirmed-relationships pending state for Phase 0', () => {
    renderPeopleGraph();
    expect(screen.getByText('Relationship graph will appear after confirmed relationships are available.')).toBeInTheDocument();
    expect(screen.getByText('Candidate edges stay in review and are not shown as relationships.')).toBeInTheDocument();
  });

  it('does not request the retired person entity type', () => {
    renderPeopleGraph();
    expect(mockUseEntityList).not.toHaveBeenCalledWith('person');
  });

  it('does not consume candidate edges for the consumer relationship graph', () => {
    renderPeopleGraph();
    expect(mockUseEntityCandidateEdges).not.toHaveBeenCalled();
  });

  it('does not render a graph from candidate edge fixtures', () => {
    mockUseEntityList.mockReturnValue({
      ...defaultList,
      data: Array.from({ length: 15 }, (_, i) => makePerson(`p${i + 1}`, `Person ${i + 1}`, [`alias${i}`])),
    });
    mockUseEntityCandidateEdges.mockReturnValue({
      ...defaultEdges,
      data: {
        candidates: [
          { source_id: 'p1', target_id: 'p2', weight: 3 },
          { source_id: 'p2', target_id: 'p3', weight: 2 },
        ],
        total: 2,
      },
    });
    renderPeopleGraph();
    expect(screen.queryByTestId('people-graph-chart')).not.toBeInTheDocument();
    expect(screen.getByText('Relationship graph will appear after confirmed relationships are available.')).toBeInTheDocument();
  });
});
