'use client';

import React from 'react';

import { useRemoteRole } from '@/hooks/useRemoteRole';

import RemoteControlProvider from './RemoteControlProvider';

export default function RemoteRoleManager() {
  const { currentRole } = useRemoteRole();

  return (
    <>
      {/* 遥控器提供者 - 根据角色决定是否显示 */}
      <RemoteControlProvider role={currentRole} />
    </>
  );
}
