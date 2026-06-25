import { useState, useCallback } from 'react';

interface GeolocationState {
  loading: boolean;
  error: string | null;
  location: string | null;
}

/**
 * Hook for browser geolocation — coordinates only.
 *
 * This hook only obtains browser coordinates and returns them as a
 * "lat, lng" string. Location naming and weather enrichment are handled by
 * the metadata UI through backend adapter routes, not by this hook.
 *
 * Permission is requested only when `detect()` is called by a UI flow.
 * Denial/unavailable/timeout does not erase draft text and does not
 * disable saving.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    loading: false,
    error: null,
    location: null,
  });

  const detect = useCallback(async (): Promise<string | null> => {
    if (!navigator.geolocation) {
      setState({ loading: false, error: 'Geolocation not available', location: null });
      return null;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    return new Promise<string | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const locationString = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
          setState({ loading: false, error: null, location: locationString });
          resolve(locationString);
        },
        (err) => {
          let message = 'Location unavailable';
          if (err.code === err.PERMISSION_DENIED) {
            message = 'Permission denied';
          } else if (err.code === err.TIMEOUT) {
            message = 'Location request timed out';
          }
          setState({ loading: false, error: message, location: null });
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000, // 5 min cache
        },
      );
    });
  }, []);

  return { ...state, detect };
}
