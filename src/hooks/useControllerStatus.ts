'use client';

import { useEffect, useState } from 'react';

import { RemoteRole, useRemoteRole } from './useRemoteRole';

type ControllerStatus = 'disconnected' | 'checking' | 'connected' | 'error';

export function useControllerStatus() {
  const { currentRole } = useRemoteRole();
  const [status, setStatus] = useState<ControllerStatus>('disconnected');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // 只有在遥控器角色时才检查状态
    if (currentRole !== RemoteRole.CONTROLLER) {
      setStatus('disconnected');
      return;
    }

    const checkControllerStatus = async () => {
      try {
        setIsLoading(true);

        // 获取遥控器会话信息
        const sessionRaw = window.localStorage.getItem('rc_controller_session');
        if (!sessionRaw) {
          setStatus('disconnected');
          return;
        }

        let sid = '';
        let token = '';
        try {
          const s = JSON.parse(sessionRaw);
          sid = s.sid || '';
          token = s.token || '';
        } catch {
          setStatus('disconnected');
          return;
        }

        if (!sid || !token) {
          setStatus('disconnected');
          return;
        }

        // 检查播放器状态
        const response = await fetch(
          `/api/remote/subscribers?sid=${encodeURIComponent(
            sid
          )}&token=${encodeURIComponent(token)}&checkType=player`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.code === 0) {
            setStatus(data.data.hasSubscribers ? 'connected' : 'checking');
          } else {
            setStatus('error');
          }
        } else {
          setStatus('error');
        }
      } catch (error) {
        // 静默处理错误，避免console输出
        setStatus('error');
      } finally {
        setIsLoading(false);
      }
    };

    // 立即检查一次
    checkControllerStatus();

    // 每5秒检查一次状态
    const interval = setInterval(checkControllerStatus, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [currentRole]);

  return {
    status,
    isLoading,
    isController: currentRole === RemoteRole.CONTROLLER,
  };
}
