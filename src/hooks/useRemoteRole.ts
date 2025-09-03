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

  // 监听localStorage变化
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'remoteRole') {
        const newRole = e.newValue as RemoteRole;
        if (newRole && Object.values(RemoteRole).includes(newRole)) {
          setCurrentRole(newRole);
        }
      }
    };

    // 监听跨标签页的localStorage变化
    window.addEventListener('storage', handleStorageChange);

    // 监听同页面内的localStorage变化（通过自定义事件）
    const handleCustomStorageChange = (e: CustomEvent) => {
      if (e.detail?.key === 'remoteRole') {
        const newRole = e.detail.value as RemoteRole;
        if (newRole && Object.values(RemoteRole).includes(newRole)) {
          setCurrentRole(newRole);
        }
      }
    };

    window.addEventListener(
      'localStorageChange',
      handleCustomStorageChange as EventListener
    );

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(
        'localStorageChange',
        handleCustomStorageChange as EventListener
      );
    };
  }, []);

  // 保存角色设置到localStorage
  const changeRole = (role: RemoteRole) => {
    setCurrentRole(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('remoteRole', role);
      // 触发自定义事件，通知同页面内的其他组件
      window.dispatchEvent(
        new CustomEvent('localStorageChange', {
          detail: { key: 'remoteRole', value: role },
        })
      );
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
