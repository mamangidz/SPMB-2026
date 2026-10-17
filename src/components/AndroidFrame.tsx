import React, { useState, useEffect } from 'react';
import { Smartphone, Maximize2, Minimize2, Wifi, BatteryCharging, Signal, LogOut } from 'lucide-react';

interface AndroidFrameProps {
  children: React.ReactNode;
  activeVenue?: string;
  username?: string;
  onLogout?: () => void;
}

export const AndroidFrame: React.FC<AndroidFrameProps> = ({
  children,
  activeVenue,
  username,
  onLogout
}) => {
  const [isPhoneMockup, setIsPhoneMockup] = useState(true);
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-0 sm:p-4 text-slate-100">
      {/* Top Device Mode Toolbar (for PC / review convenience) */}
      <header className="w-full max-w-4xl flex items-center justify-between px-4 py-2 mb-3 bg-slate-900/90 backdrop-blur rounded-2xl border border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-semibold text-slate-200 hidden sm:inline">Aplikasi Android SPMB STAN</span>
          {activeVenue && (
            <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
              {activeVenue} ({username})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPhoneMockup(!isPhoneMockup)}
            className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors border border-slate-700 font-medium cursor-pointer"
            title="Ganti Mode Frame Smartphone / Layar Penuh"
          >
            {isPhoneMockup ? (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">Layar Penuh</span>
              </>
            ) : (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">Mockup HP</span>
              </>
            )}
          </button>

          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center gap-1 px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-lg transition-colors border border-rose-500/30 font-semibold cursor-pointer"
              title="Keluar dari Aplikasi (Logout)"
            >
              <LogOut className="w-3.5 h-3.5 text-rose-400" />
              <span>Keluar</span>
            </button>
          )}
        </div>
      </header>

      {/* Frame Container */}
      {isPhoneMockup ? (
        <div className="relative w-full max-w-[410px] h-[870px] max-h-[96vh] bg-slate-950 rounded-[48px] shadow-2xl shadow-sky-950/40 p-3.5 border-[6px] border-slate-800 ring-1 ring-slate-700/50 flex flex-col overflow-hidden">
          {/* Hardware buttons decoration */}
          <div className="absolute -left-2 top-28 w-1 h-12 bg-slate-700 rounded-r-md"></div>
          <div className="absolute -left-2 top-44 w-1 h-12 bg-slate-700 rounded-r-md"></div>
          <div className="absolute -right-2 top-36 w-1 h-16 bg-slate-700 rounded-l-md"></div>

          {/* Android Screen Inner */}
          <div className="relative flex-1 bg-slate-900 rounded-[38px] overflow-hidden flex flex-col border border-slate-800 shadow-inner">
            {/* Android Status Bar */}
            <div className="h-8 bg-slate-950/90 backdrop-blur px-6 flex items-center justify-between text-[11px] text-slate-300 select-none z-30 shrink-0">
              <span className="font-semibold tracking-tight font-mono">{currentTime || '09:41'}</span>
              
              {/* Camera punch hole cutout */}
              <div className="absolute left-1/2 -translate-x-1/2 top-1.5 w-4 h-4 bg-black rounded-full ring-2 ring-slate-800/80 flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-slate-900 rounded-full"></div>
              </div>

              <div className="flex items-center gap-1.5 text-slate-300">
                <Signal className="w-3 h-3 text-slate-300" />
                <span className="font-semibold text-[9px] text-sky-400">5G</span>
                <Wifi className="w-3 h-3 text-slate-300" />
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] font-mono">98%</span>
                  <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              </div>
            </div>

            {/* Application Viewport */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col relative bg-slate-900">
              {children}
            </div>

            {/* Android Navigation Pill Bar */}
            <div className="h-4 bg-slate-950 flex items-center justify-center shrink-0">
              <div className="w-28 h-1 bg-slate-600 rounded-full"></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-md h-[95vh] bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col">
          {children}
        </div>
      )}
    </div>
  );
};
