import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import PublicLinkExchange from './PublicLinkExchange';

const mocks = vi.hoisted(() => ({
  publicLinkAPI: {
    exchange: vi.fn(),
  },
}));

vi.mock('@/lib/api-client', () => ({
  publicLinkAPI: mocks.publicLinkAPI,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-location">{location.pathname}{location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<LocationProbe />} />
        <Route path="/link" element={(
          <>
            <PublicLinkExchange />
            <LocationProbe />
          </>
        )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicLinkExchange', () => {
  afterEach(() => {
    mocks.publicLinkAPI.exchange.mockReset();
  });

  it('exchanges the code and replaces the route with a clean redirect target', async () => {
    mocks.publicLinkAPI.exchange.mockResolvedValue({ redirectTo: '/' });

    renderAt('/link?code=abc123');

    await waitFor(() => {
      expect(mocks.publicLinkAPI.exchange).toHaveBeenCalledWith({ code: 'abc123' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent('/');
    });
  });

  it('removes the code from the URL and shows the exchange error on failure', async () => {
    mocks.publicLinkAPI.exchange.mockRejectedValue(new Error('Code expired'));

    renderAt('/link?code=expired');

    await waitFor(() => {
      expect(mocks.publicLinkAPI.exchange).toHaveBeenCalledWith({ code: 'expired' });
    });
    expect(await screen.findByText('Code expired')).toBeInTheDocument();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/link');
  });

  it('does not exchange when the URL has no code', async () => {
    renderAt('/link');

    expect(await screen.findByText(/未找到访问码|No access code/i)).toBeInTheDocument();
    expect(mocks.publicLinkAPI.exchange).not.toHaveBeenCalled();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/link');
  });
});
