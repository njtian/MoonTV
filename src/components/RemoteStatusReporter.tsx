'use client';

import { useRemoteStatus } from '@/hooks/useRemoteStatus';

export function RemoteStatusReporter() {
  useRemoteStatus();
  return null; // This component doesn't render anything
}