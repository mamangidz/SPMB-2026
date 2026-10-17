import React from 'react';
import { Bell, CheckCircle2, Image as ImageIcon, UserCheck, X } from 'lucide-react';
import { SystemNotification } from '../types';

interface ToastProps {
  notification: SystemNotification | null;
  onDismiss: () => void;
}

export const ToastNotification: React.FC<ToastProps> = ({ notification, onDismiss }) => {
  if (!notification) return null;

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm w-full bg-slate-900/95 border border-sky-500/40 rounded-2xl p-4 shadow-2xl shadow-sky-950/80 backdrop-blur-md animate-in slide-in-from-top-4 duration-300">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 shrink-0">
          {notification.type === 'login' ? (
            <UserCheck className="w-5 h-5 text-emerald-400" />
          ) : notification.type === 'upload' ? (
            <ImageIcon className="w-5 h-5 text-amber-400" />
          ) : (
            <Bell className="w-5 h-5 text-sky-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              {notification.title}
            </h4>
            <button
              onClick={onDismiss}
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
            {notification.message}
          </p>
          <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500 font-mono">
            <span>{notification.venue || 'Sistem'}</span>
            <span>{new Date(notification.createdAt).toLocaleTimeString('id-ID')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
