import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImportWorkflow from './ImportWorkflow';

const importHookCalls = vi.hoisted(() => ({
  plan: vi.fn(),
  run: vi.fn(),
  status: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock('@/hooks/useImports', () => ({
  useImportPlan: importHookCalls.plan,
  useImportRun: importHookCalls.run,
  useImportStatus: importHookCalls.status,
  useImportRollback: importHookCalls.rollback,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    lang: 'en',
    t: (key: string) => ({
      importTitle: 'Import Data',
      importComingSoonTitle: 'Import is coming soon',
      importComingSoonDescription:
        'Import tools are not available in the GUI yet. Your existing journals remain unchanged.',
      comingSoon: 'Coming Soon',
    }[key] ?? key),
  }),
}));

describe('ImportWorkflow coming-soon page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an honest whole-page Coming Soon state', () => {
    render(<ImportWorkflow />);

    expect(screen.getByTestId('import-coming-soon-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Import is coming soon' })).toBeInTheDocument();
    expect(screen.getByText('Coming Soon')).toBeInTheDocument();
    expect(screen.getByText(
      'Import tools are not available in the GUI yet. Your existing journals remain unchanged.',
    )).toBeInTheDocument();
  });

  it('renders no actionable import workflow and invokes no import hooks', () => {
    render(<ImportWorkflow />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-input-path')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-generate-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-confirm-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-status-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-rollback-btn')).not.toBeInTheDocument();
    expect(importHookCalls.plan).not.toHaveBeenCalled();
    expect(importHookCalls.run).not.toHaveBeenCalled();
    expect(importHookCalls.status).not.toHaveBeenCalled();
    expect(importHookCalls.rollback).not.toHaveBeenCalled();
  });
});
