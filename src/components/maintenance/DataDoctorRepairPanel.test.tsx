import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataDoctorRepairPanel } from './DataDoctorRepairPanel';

// ── Fixtures ───────────────────────────────────────────────────────────────

const mockIssue = {
  issue_id: 'layout.missing_generated_index:INDEX.md',
  domain: 'layout',
  severity: 'warning' as const,
  summary: 'Missing generated index file',
};

const mockIssueCritical = {
  issue_id: 'frontmatter.missing_date:2024-01-01.md',
  domain: 'frontmatter',
  severity: 'error' as const,
  summary: 'Missing date in frontmatter',
};

const mockPlan = {
  schema_version: 'm33.maintenance_plan.v0',
  issue_id: mockIssue.issue_id,
  repairable: true,
  touched_paths: ['INDEX.md'],
};

const mockDryRunSuccess = {
  schema_version: 'm33.maintenance_repair.v0',
  issue_id: mockIssue.issue_id,
  dry_run: true,
  planned_paths: ['INDEX.md'],
};

const mockApplyResult = {
  schema_version: 'm33.maintenance_repair.v0',
  issue_id: mockIssue.issue_id,
  dry_run: false,
  applied: true,
  changed_paths: ['INDEX.md'],
};

const defaultCallbacks = {
  onSelectIssue: vi.fn(),
  onPlan: vi.fn(),
  onDryRun: vi.fn(),
  onConfirmationToggle: vi.fn(),
  onApply: vi.fn(),
  onRetry: vi.fn(),
  onPostCheck: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DataDoctorRepairPanel', () => {
  // ── Audit loading state ────────────────────────────────────────────────

  it('renders audit loading state', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={true}
        auditError={false}
        issues={[]}
        selectedIssue={null}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('data-doctor-loading')).toBeInTheDocument();
    expect(screen.getByText('正在加载审计数据...')).toBeInTheDocument();
  });

  // ── Audit empty state ──────────────────────────────────────────────────

  it('renders empty state when no issues found', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[]}
        selectedIssue={null}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('data-doctor-empty')).toBeInTheDocument();
    expect(screen.getByText('未发现可修复问题')).toBeInTheDocument();
  });

  // ── Audit error state ──────────────────────────────────────────────────

  it('renders error state when audit fails', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={true}
        issues={[]}
        selectedIssue={null}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('data-doctor-error')).toBeInTheDocument();
    expect(screen.getByText('审计数据加载失败')).toBeInTheDocument();
  });

  // ── Issues list ────────────────────────────────────────────────────────

  it('renders issue rows with severity, domain, issue id, and summary', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue, mockIssueCritical]}
        selectedIssue={null}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('data-doctor-issues-list')).toBeInTheDocument();
    expect(screen.getByTestId(`issue-row-${mockIssue.issue_id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`issue-row-${mockIssueCritical.issue_id}`)).toBeInTheDocument();

    // Severity badges
    expect(screen.getByTestId(`issue-severity-${mockIssue.issue_id}`)).toHaveTextContent('warning');
    expect(screen.getByTestId(`issue-severity-${mockIssueCritical.issue_id}`)).toHaveTextContent('error');

    // Domain
    expect(screen.getByTestId(`issue-domain-${mockIssue.issue_id}`)).toHaveTextContent('layout');

    // Issue ID
    expect(screen.getByTestId(`issue-id-${mockIssue.issue_id}`)).toHaveTextContent(mockIssue.issue_id);

    // Summary
    expect(screen.getByTestId(`issue-summary-${mockIssue.issue_id}`)).toHaveTextContent(mockIssue.summary);
  });

  it('calls onSelectIssue when an issue row is clicked', () => {
    const onSelectIssue = vi.fn();
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={null}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
        onSelectIssue={onSelectIssue}
      />,
    );

    fireEvent.click(screen.getByTestId(`issue-row-${mockIssue.issue_id}`));
    expect(onSelectIssue).toHaveBeenCalledWith(mockIssue);
  });

  it('highlights the selected issue row', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    const selectedRow = screen.getByTestId(`issue-row-${mockIssue.issue_id}`);
    expect(selectedRow.getAttribute('data-selected')).toBe('true');
  });

  // ── Plan section ───────────────────────────────────────────────────────

  it('renders plan section when plan is provided', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('data-doctor-plan-section')).toBeInTheDocument();
    expect(screen.getByTestId('plan-repairable')).toHaveTextContent('可修复');
    expect(screen.getByTestId('plan-touched-paths')).toHaveTextContent('INDEX.md');
  });

  it('calls onPlan when plan button is clicked', () => {
    const onPlan = vi.fn();
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
        onPlan={onPlan}
      />,
    );

    fireEvent.click(screen.getByTestId('plan-button'));
    expect(onPlan).toHaveBeenCalledWith(mockIssue.issue_id);
  });

  // ── Dry-run section ────────────────────────────────────────────────────

  it('renders dry-run section when dryRun is provided', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('data-doctor-dryrun-section')).toBeInTheDocument();
    expect(screen.getByTestId('dryrun-preview-label')).toBeInTheDocument();
    expect(screen.getByTestId('dryrun-planned-paths')).toHaveTextContent('INDEX.md');
  });

  it('calls onDryRun when dry-run button is clicked', () => {
    const onDryRun = vi.fn();
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
        onDryRun={onDryRun}
      />,
    );

    fireEvent.click(screen.getByTestId('dryrun-button'));
    expect(onDryRun).toHaveBeenCalledWith(mockIssue.issue_id);
  });

  it('distinguishes dry-run preview from apply in copy', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('dryrun-preview-label')).toHaveTextContent('演练预览');
    expect(screen.getByTestId('apply-button')).toHaveTextContent('执行修复');
  });

  // ── Apply controls ─────────────────────────────────────────────────────

  it('disables apply button when dry-run has not succeeded', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('apply-button')).toBeDisabled();
  });

  it('disables apply button when dry-run succeeded but not confirmed', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('apply-button')).toBeDisabled();
  });

  it('enables apply button when dry-run succeeded and confirmed', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={true}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('apply-button')).not.toBeDisabled();
  });

  it('calls onApply when apply button is clicked', () => {
    const onApply = vi.fn();
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={true}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId('apply-button'));
    expect(onApply).toHaveBeenCalledWith(mockIssue.issue_id);
  });

  it('calls onConfirmationToggle when confirmation checkbox is toggled', () => {
    const onConfirmationToggle = vi.fn();
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
        onConfirmationToggle={onConfirmationToggle}
      />,
    );

    fireEvent.click(screen.getByTestId('confirm-checkbox'));
    expect(onConfirmationToggle).toHaveBeenCalledWith(true);
  });

  // ── Callbacks without auto-invocation ──────────────────────────────────

  it('does not auto-invoke any callbacks on mount', () => {
    const callbacks = {
      onSelectIssue: vi.fn(),
      onPlan: vi.fn(),
      onDryRun: vi.fn(),
      onConfirmationToggle: vi.fn(),
      onApply: vi.fn(),
      onRetry: vi.fn(),
      onPostCheck: vi.fn(),
    };

    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={true}
        applyResult={null}
        postCheck={null}
        {...callbacks}
      />,
    );

    expect(callbacks.onSelectIssue).not.toHaveBeenCalled();
    expect(callbacks.onPlan).not.toHaveBeenCalled();
    expect(callbacks.onDryRun).not.toHaveBeenCalled();
    expect(callbacks.onConfirmationToggle).not.toHaveBeenCalled();
    expect(callbacks.onApply).not.toHaveBeenCalled();
    expect(callbacks.onRetry).not.toHaveBeenCalled();
    expect(callbacks.onPostCheck).not.toHaveBeenCalled();
  });

  // ── Retry / post-check callbacks ───────────────────────────────────────

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={true}
        issues={[]}
        selectedIssue={null}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByTestId('retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('calls onPostCheck when post-check button is clicked', () => {
    const onPostCheck = vi.fn();
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={true}
        applyResult={mockApplyResult}
        postCheck={null}
        {...defaultCallbacks}
        onPostCheck={onPostCheck}
      />,
    );

    fireEvent.click(screen.getByTestId('postcheck-button'));
    expect(onPostCheck).toHaveBeenCalledTimes(1);
  });

  // ── Apply result display ───────────────────────────────────────────────

  it('renders apply result when provided', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={true}
        applyResult={mockApplyResult}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('apply-result-section')).toBeInTheDocument();
    expect(screen.getByTestId('apply-changed-paths')).toHaveTextContent('INDEX.md');
  });

  // ── Post-check display ─────────────────────────────────────────────────

  it('renders post-check result when provided', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={true}
        applyResult={mockApplyResult}
        postCheck={{ passed: true, message: 'Post-check passed' }}
        {...defaultCallbacks}
      />,
    );

    expect(screen.getByTestId('postcheck-section')).toBeInTheDocument();
    expect(screen.getByText('Post-check passed')).toBeInTheDocument();
  });

  // ── Safety: no direct rebuild controls ─────────────────────────────────

  it('does not render any direct rebuild controls', () => {
    render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={mockPlan}
        dryRun={mockDryRunSuccess}
        dryRunSuccess={true}
        confirmed={true}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    expect(screen.queryByTestId('rebuild-button')).not.toBeInTheDocument();
    expect(screen.queryByText(/rebuild/i)).not.toBeInTheDocument();
  });

  // ── Mobile text overflow prevention ────────────────────────────────────

  it('uses break-words or overflow-hidden classes to prevent text overflow', () => {
    const { container } = render(
      <DataDoctorRepairPanel
        auditLoading={false}
        auditError={false}
        issues={[mockIssue]}
        selectedIssue={mockIssue}
        plan={null}
        dryRun={null}
        dryRunSuccess={false}
        confirmed={false}
        applyResult={null}
        postCheck={null}
        {...defaultCallbacks}
      />,
    );

    const issueRows = container.querySelectorAll('[data-testid^="issue-row-"]');
    issueRows.forEach((row) => {
      const el = row as HTMLElement;
      const classes = el.className;
      const hasOverflowProtection =
        classes.includes('break-words') ||
        classes.includes('overflow-hidden') ||
        classes.includes('min-w-0') ||
        classes.includes('truncate');
      expect(hasOverflowProtection).toBe(true);
    });
  });
});
