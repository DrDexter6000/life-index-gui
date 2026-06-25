import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { JournalCard } from './JournalCard';

describe('JournalCard', () => {
  const defaultProps = {
    id: 'journal-1',
    title: 'Test Journal Entry',
    excerpt: 'This is a test excerpt for the journal card.',
    date: '2024-01-15',
    topics: ['日常', '思考'],
    moods: ['平静'],
    moodEmoji: '🌿',
  };

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
  };

  it('should render journal card with all content', () => {
    renderWithRouter(<JournalCard {...defaultProps} />);

    expect(screen.getByText('Test Journal Entry')).toBeInTheDocument();
    expect(screen.getByText('This is a test excerpt for the journal card.')).toBeInTheDocument();
  });

  it('should render topics as outline badges', () => {
    renderWithRouter(<JournalCard {...defaultProps} />);

    expect(screen.getByText('日常')).toBeInTheDocument();
    expect(screen.getByText('思考')).toBeInTheDocument();
  });

  it('should render mood as outline tag', () => {
    renderWithRouter(<JournalCard {...defaultProps} />);

    expect(screen.getByText('平静')).toBeInTheDocument();
  });

  it('should render as link when not demo', () => {
    renderWithRouter(<JournalCard {...defaultProps} isDemo={false} />);

    const link = screen.getByRole('link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/journal/journal-1');
  });

  it('should not render as link when demo', () => {
    renderWithRouter(<JournalCard {...defaultProps} isDemo={true} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('should format date parts correctly', () => {
    renderWithRouter(<JournalCard {...defaultProps} date="2024-03-15" />);

    expect(screen.getByText('MAR')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('should limit topics to 2', () => {
    renderWithRouter(
      <JournalCard {...defaultProps} topics={['话题1', '话题2', '话题3', '话题4']} />
    );

    expect(screen.getByText('话题1')).toBeInTheDocument();
    expect(screen.getByText('话题2')).toBeInTheDocument();
    expect(screen.queryByText('话题3')).not.toBeInTheDocument();
    expect(screen.queryByText('话题4')).not.toBeInTheDocument();
  });

  it('should limit moods to 1', () => {
    renderWithRouter(
      <JournalCard {...defaultProps} moods={['开心', '兴奋', '平静']} />
    );

    expect(screen.getByText('开心')).toBeInTheDocument();
    expect(screen.queryByText('兴奋')).not.toBeInTheDocument();
  });

  it('should render horizontal layout with date pillar', () => {
    const { container } = renderWithRouter(<JournalCard {...defaultProps} />);

    const goldLine = container.querySelector('.journal-card-gold-line');
    expect(goldLine).toBeInTheDocument();
  });
});
