import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PeopleGraph } from './PeopleGraph';

const mockUseEntityList = vi.fn();
const mockUseEntityCandidateEdges = vi.fn();
const mockNavigate = vi.fn();

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
  it('shows loading state while entities are loading', () => {
    mockUseEntityList.mockReturnValue({ ...defaultList, isLoading: true });
    renderPeopleGraph();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows no-data state when there are zero entities', () => {
    mockUseEntityList.mockReturnValue({ ...defaultList, data: [] });
    renderPeopleGraph();
    expect(screen.getByText('No Data')).toBeInTheDocument();
  });

  it('shows low-data empty state when there are fewer than 8 nodes', () => {
    mockUseEntityList.mockReturnValue({
      ...defaultList,
      data: [
        makePerson('p1', 'Alice'),
        makePerson('p2', 'Bob'),
        makePerson('p3', 'Carol'),
        makePerson('p4', 'Dave'),
        makePerson('p5', 'Eve'),
      ],
    });
    renderPeopleGraph();
    expect(screen.getByText('More journal entries will reveal your constellation of connections')).toBeInTheDocument();
    expect(screen.getByText('Keep writing — your people graph will appear here.')).toBeInTheDocument();
  });

  it('renders the graph when there are 8 or more nodes', () => {
    mockUseEntityList.mockReturnValue({
      ...defaultList,
      data: Array.from({ length: 8 }, (_, i) => makePerson(`p${i + 1}`, `Person ${i + 1}`)),
    });
    renderPeopleGraph();
    expect(screen.queryByText('More journal entries will reveal your constellation of connections')).not.toBeInTheDocument();
    expect(screen.queryByText('No Data')).not.toBeInTheDocument();
    // Both kicker and title render "People Graph" in the mock; verify at least one heading is present
    expect(screen.getByRole('heading', { name: 'People Graph' })).toBeInTheDocument();
  });

  it('renders the graph when there are many nodes', () => {
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
    expect(screen.queryByText('More journal entries will reveal your constellation of connections')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'People Graph' })).toBeInTheDocument();
  });
});
