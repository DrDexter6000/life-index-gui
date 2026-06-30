import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router';
import { publicLinkAPI } from '@/lib/api-client';
import { useTranslation } from '@/hooks/useTranslation';

export default function PublicLinkExchange() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const cleanedFailedCodeRef = useRef(false);
  const tRef = useRef(t);

  const code = searchParams.get('code');

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!code) {
      if (cleanedFailedCodeRef.current) return;
      if (location.search) {
        navigate('/link', { replace: true });
      }
      setError(tRef.current('publicLinkExchangeNoCode'));
      return;
    }

    let cancelled = false;
    setExchanging(true);

    publicLinkAPI
      .exchange({ code })
      .then((data) => {
        if (cancelled) return;
        const redirectTo = data.redirectTo || '/';
        navigate(redirectTo, { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        cleanedFailedCodeRef.current = true;
        setError(err instanceof Error ? err.message : tRef.current('publicLinkExchangeFailed'));
        setExchanging(false);
        // Remove the code from the address bar after preserving the visible error.
        navigate('/link', { replace: true });
      })
      .finally(() => {
        if (!cancelled) setExchanging(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code, location.search, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm text-center">
        {exchanging && (
          <p className="text-sm text-[var(--color-secondary)]">
            {t('publicLinkExchangeLoading')}
          </p>
        )}
        {error && !exchanging && (
          <p className="rounded-lg border border-[var(--color-coral)]/25 bg-[var(--color-coral)]/10 p-3 text-sm text-[var(--color-coral)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
