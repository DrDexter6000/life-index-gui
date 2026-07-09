import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { APIClientError } from '@/lib/api-client';
import EntityProfile from './EntityProfile';

const mockUseEntityProfile = vi.fn();

vi.mock('@/hooks/useJournals', () => ({
  useEntityProfile: (id?: string) => mockUseEntityProfile(id),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    lang: 'en',
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        back: 'Back',
        retry: 'Retry',
        loading: 'Loading...',
        entityProfileTitle: 'Entity Profile',
        entityProfileAliases: 'Aliases',
        entityProfileRelationships: 'Confirmed relationships',
        entityProfileMentions: 'Journal mentions',
        entityProfileEvidence: 'Evidence',
        entityProfileStats: 'Stats',
        entityProfileSelf: 'Self anchor',
        entityProfileStatus: 'Status',
        entityProfileType: 'Type',
        entityProfileKind: 'Kind',
        entityProfileMentionCount: 'Mentions',
        entityProfileRelationshipCount: 'Relationships',
        entityProfileFirstMention: 'First mention',
        entityProfileLatestMention: 'Latest mention',
        entityProfileNoAliases: 'No aliases recorded',
        entityProfileNoRelationships: 'No confirmed relationships',
        entityProfileNoMentions: 'No journal mentions',
        entityProfileNoEvidence: 'No relationship evidence',
        entityProfileCandidateTitle: 'Pending review',
        entityProfileCandidateDesc: 'This entity is still a candidate. Review it before opening a confirmed profile.',
        entityProfileReviewLink: 'Open entity review',
        entityProfileNotFoundTitle: 'Entity not found',
        entityProfileUnavailableTitle: 'Entity profile unavailable',
        entityProfileCliCommand: 'CLI command',
        entityProfileEvidenceCount: '{{count}} evidence',
      };
      let text = map[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replace(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
  }),
}));

const profileFixture = {
  identity: {
    entity_id: 'actor-alice',
    primary_name: 'Alice',
    aliases: ['Ally'],
    type: 'actor',
    kind: 'human',
    status: 'confirmed',
    is_self: true,
  },
  relationships: [
    {
      target: 'actor-bob',
      target_name: 'Bob',
      relation: 'friend_of',
      source: 'user',
      status: 'confirmed',
      evidence: ['Journals/2026/03/life-index_2026-03-15_001.md'],
    },
    {
      target: 'actor-candidate',
      target_name: 'Candidate',
      relation: 'met',
      source: 'candidate',
      status: 'candidate',
      evidence: ['Journals/2026/03/life-index_2026-03-16_001.md'],
    },
  ],
  mentions: [
    {
      rel_path: 'Journals/2026/03/life-index_2026-03-15_001.md',
      date: '2026-03-15',
      title: 'Primary Mention',
    },
  ],
  evidence: ['Journals/2026/03/life-index_2026-03-15_001.md'],
  stats: {
    first_mention: '2026-03-15',
    latest_mention: '2026-03-15',
    mention_count: 1,
    relationship_count: 1,
  },
};

function renderEntityProfile(path = '/entities/actor-alice') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/entities/:entityId" element={<EntityProfile />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseEntityProfile.mockReturnValue({
    data: profileFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('EntityProfile', () => {
  it('renders identity, aliases, confirmed relationships, mentions, evidence, and stats', () => {
    renderEntityProfile();

    expect(mockUseEntityProfile).toHaveBeenCalledWith('actor-alice');
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByText('actor-alice')).toBeInTheDocument();
    expect(screen.getByText('Self anchor')).toBeInTheDocument();
    expect(screen.getByText('Ally')).toBeInTheDocument();
    expect(screen.getByText('friend_of')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Primary Mention')).toBeInTheDocument();
    expect(screen.getAllByText('Journals/2026/03/life-index_2026-03-15_001.md')).toHaveLength(2);
    expect(screen.getAllByText('2026-03-15').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('links journal mentions to the existing journal detail route without reading files', () => {
    renderEntityProfile();

    expect(screen.getByRole('link', { name: /Primary Mention/ })).toHaveAttribute(
      'href',
      '/journal/2026/03/life-index_2026-03-15_001',
    );
  });

  it('does not render candidate relationships in the confirmed profile UI', () => {
    renderEntityProfile();

    expect(screen.queryByText('Candidate')).not.toBeInTheDocument();
    expect(screen.queryByText('met')).not.toBeInTheDocument();
  });

  it('renders candidate profile errors as review guidance', () => {
    mockUseEntityProfile.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new APIClientError(
        'candidate entities do not have confirmed profiles',
        'ENTITY_PROFILE_CANDIDATE',
        200,
        {
          entity_id: 'actor-morgan',
          status: 'candidate',
          suggested_command: 'life-index entity --review',
        },
      ),
      refetch: vi.fn(),
    });

    renderEntityProfile('/entities/actor-morgan');

    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('life-index entity --review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open entity review' })).toHaveAttribute(
      'href',
      '/maintenance/entities',
    );
  });
});
