'use client';

import { useEffect, useState } from 'react';

export enum RemoteRole {
  OFF = 'off',
  PLAYER = 'player',
  CONTROLLER = 'controller',
}

const ROLE_CONFIG = {
  [RemoteRole.OFF]: {
    label: '关闭',
    description: '不启用遥控器功能',
    icon: '🔒',
  },
  [RemoteRole.PLAYER]: {
    label: '受控播放器',
    description: '作为播放器接受遥控器控制',
    icon: '📺',
  },
  [RemoteRole.CONTROLLER]: {
    label: '遥控器',
    description: '作为遥控器控制播放器',
    icon: '📱',
  },
};

export function useRemoteRole() {
  const [currentRole, setCurrentRole] = useState<RemoteRole>(RemoteRole.OFF);

  // 从localStorage加载角色设置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedRole = localStorage.getItem('remoteRole') as RemoteRole;
      if (savedRole && Object.values(RemoteRole).includes(savedRole)) {
        setCurrentRole(savedRole);
      }
    }
  }, []);

  // 保存角色设置到localStorage
  const changeRole = (role: RemoteRole) => {
    setCurrentRole(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('remoteRole', role);
    }
  };

  const getRoleConfig = (role: RemoteRole) => ROLE_CONFIG[role];

  return {
    currentRole,
    changeRole,
    getRoleConfig,
    ROLE_CONFIG,
  };
}
