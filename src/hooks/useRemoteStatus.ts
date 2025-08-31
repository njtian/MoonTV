'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

type PageStatus = {
  type: 'status';
  payload: {
    page: 'home' | 'play' | 'search' | 'detail' | 'other';
    pageTitle?: string;
    // Play page specific fields
    duration?: number;
    currentTime?: number;
    paused?: boolean;
    title?: string;
    episodeIndex?: number;
    totalEpisodes?: number;
    cover?: string;
  };
};

export function useRemoteStatus() {
  const pathname = usePathname();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Don't send status from controller page itself
    if (pathname === '/controller') {
      return;
    }

    const sendStatus = async () => {
      try {
        // Get session info from sessionStorage
        const sidRaw = window.sessionStorage.getItem('rc_session');
        if (!sidRaw) return;

        let sid = '';
        let token = '';
        try {
          const s = JSON.parse(sidRaw);
          sid = s.sid || '';
          token = s.token || '';
        } catch {
          return;
        }

        if (!sid || !token) return;

        // Determine current page type
        let page: PageStatus['payload']['page'] = 'other';
        let pageTitle = '';

        if (pathname === '/') {
          page = 'home';
          pageTitle = '首页';
        } else if (pathname === '/search') {
          page = 'search';
          pageTitle = '搜索';
        } else if (pathname.startsWith('/detail/')) {
          page = 'detail';
          pageTitle = '详情页';
        } else if (pathname === '/play') {
          // For play page, status will be sent by the play page itself with video details
          // So we don't need to send generic status here
          return;
        }

        // Send status update
        await fetch('/api/remote/status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sid,
            token,
            message: {
              type: 'status',
              payload: {
                page,
                pageTitle,
              },
            } as PageStatus,
          }),
        });
      } catch {
        // Ignore errors
      }
    };

    // Send initial status immediately
    sendStatus();

    // Send status every 2 seconds
    intervalRef.current = setInterval(sendStatus, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pathname]);
}