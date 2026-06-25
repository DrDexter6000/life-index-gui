import React from 'react';
import { GlassCard } from './GlassCard';
import { useTranslation } from '@/hooks/useTranslation';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * ErrorBoundary — catches render errors and shows a graceful fallback
 * instead of crashing the entire app.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught:', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return <DefaultFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error }: { error?: Error }) {
  const { t } = useTranslation();

  return (
    <div className="max-w-[800px] mx-auto px-6 py-20 text-center">
      <GlassCard className="p-8 inline-block" hoverable={false}>
        <span className="material-symbols-outlined text-[var(--color-coral)] text-4xl mb-4 block">
          error_outline
        </span>
        <h2 className="text-lg font-semibold text-[var(--color-primary)] mb-2">
          {t('loadFailed')}
        </h2>
        <p className="text-sm text-[var(--color-secondary)] mb-6">
          {t('checkNetwork')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-300 border"
          style={{
            background: 'var(--color-gold-10)',
            borderColor: 'var(--color-gold-25)',
            color: 'var(--color-gold)',
          }}
        >
          <span className="material-symbols-outlined text-base">refresh</span>
          {t('retry')}
        </button>
        {error && process.env.NODE_ENV === 'development' && (
          <pre className="mt-6 text-left text-xs text-[var(--color-muted)] overflow-auto max-h-[200px] p-3 rounded-lg border border-white/[0.06] bg-[var(--color-ether-surface-ghost)]">
            {error.stack}
          </pre>
        )}
      </GlassCard>
    </div>
  );
}
