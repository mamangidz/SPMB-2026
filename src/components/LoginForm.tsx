import React, { useState } from 'react';
import { Lock, User, ArrowRight, ShieldCheck, KeyRound, ShieldAlert, Sparkles, Building2 } from 'lucide-react';
import { UserAccount } from '../types';
import { INITIAL_USERS } from '../data/initialData';

interface LoginFormProps {
  users: UserAccount[];
  onLogin: (user: UserAccount) => void;
  isLoading?: boolean;
}

export const LoginForm: React.FC<LoginFormProps> = ({ users, onLogin, isLoading }) => {
  // REQUIREMENT 7: Form user login setiap venue dan KOSONGKAN FIELD INPUT secara default
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showQuickAccounts, setShowQuickAccounts] = useState<boolean>(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanUsername || !cleanPassword) {
      setErrorMessage('Harap isi username dan password Anda.');
      return;
    }

    // 1. Direct admin bypass check: Always allow admin login (accepts both admin123 and admin)
    if (cleanUsername === 'admin' && (cleanPassword === 'admin123' || cleanPassword === 'admin')) {
      const adminAcc: UserAccount = users.find((u) => u.username.toLowerCase() === 'admin') ||
        INITIAL_USERS.find((u) => u.username.toLowerCase() === 'admin') || {
          id: 'user_21',
          no: 21,
          venue: 'Pusat',
          username: 'admin',
          password: 'admin123',
          role: 'admin',
          ujiFungsi: '-',
          tahap1Tasks: [],
          tahap2Dates: [],
          isOnline: true
        };
      onLogin(adminAcc);
      return;
    }

    // 2. Check in dynamic users list
    let matchedUser = users.find(
      (u) => u.username.trim().toLowerCase() === cleanUsername && u.password.trim() === cleanPassword
    );

    // 3. Fallback to INITIAL_USERS if not in dynamic list (e.g., initial sync or offline)
    if (!matchedUser) {
      matchedUser = INITIAL_USERS.find(
        (u) => u.username.trim().toLowerCase() === cleanUsername && u.password.trim() === cleanPassword
      );
    }

    if (matchedUser) {
      onLogin(matchedUser);
    } else {
      setErrorMessage('Username atau password tidak cocok dengan data venue.');
    }
  };

  const selectAccountQuickFill = (acc: UserAccount) => {
    setUsername(acc.username);
    setPassword(acc.password);
    setShowQuickAccounts(false);
  };

  const handleQuickAdminLogin = () => {
    const adminAcc: UserAccount = users.find((u) => u.username.toLowerCase() === 'admin') ||
      INITIAL_USERS.find((u) => u.username.toLowerCase() === 'admin') || {
        id: 'user_21',
        no: 21,
        venue: 'Pusat',
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        ujiFungsi: '-',
        tahap1Tasks: [],
        tahap2Dates: [],
        isOnline: true
      };
    onLogin(adminAcc);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-100 font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Background radial accent glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-sky-950/40 relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 mx-auto flex items-center justify-center font-black text-2xl text-white shadow-xl shadow-sky-950 mb-3 ring-4 ring-slate-800">
            STAN
          </div>
          <h1 className="text-xl font-extrabold text-slate-100 tracking-tight">
            Monitoring SPMB STAN 2026
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Silakan masukkan kredensial akun venue Anda untuk melanjutkan.
          </p>
        </div>

        {/* Quick Admin Login Shortcut Banner */}
        <div className="mb-5 p-3 rounded-2xl bg-indigo-950/40 border border-indigo-800/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/30 text-indigo-400 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-indigo-200">Admin Pusat</div>
              <div className="text-[10px] text-indigo-400 font-mono truncate">admin / admin123</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleQuickAdminLogin}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shrink-0 transition-colors shadow flex items-center gap-1"
          >
            Masuk Admin <Sparkles className="w-3 h-3 text-amber-300" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Login Form with Empty Inputs by Default (Requirement #7) */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Username Venue / Admin</span>
              <span className="text-[10px] text-slate-500 font-normal">Sesuai tabel penugasan</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username (contoh: admin, muklis)..."
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Password</span>
              <span className="text-[10px] text-slate-500 font-normal">Contoh: admin123, muklis123</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password Anda..."
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all font-medium font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-sky-950 flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50 mt-2 cursor-pointer"
          >
            {isLoading ? (
              'Memverifikasi Kredensial...'
            ) : (
              <>
                Masuk ke Aplikasi <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick Credentials Helper popover */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-center">
          <button
            type="button"
            onClick={() => setShowQuickAccounts(!showQuickAccounts)}
            className="text-xs text-sky-400 hover:text-sky-300 font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5" />
            {showQuickAccounts ? 'Sembunyikan Bantuan Akun' : 'Lihat Daftar 21 Akun Uji Coba'}
          </button>

          {showQuickAccounts && (
            <div className="mt-3 bg-slate-950/90 rounded-2xl p-3 border border-slate-800 text-left text-xs max-h-56 overflow-y-auto space-y-1.5">
              <div className="text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
                <span>Klik untuk mengisi form:</span>
                <span className="text-[10px] text-slate-500 font-mono">21 akun terdaftar</span>
              </div>

              {/* Admin Button */}
              <button
                type="button"
                onClick={() => {
                  setUsername('admin');
                  setPassword('admin123');
                  setShowQuickAccounts(false);
                }}
                className="w-full p-2 rounded-lg bg-indigo-950/60 hover:bg-indigo-900/70 border border-indigo-700/60 text-left flex items-center justify-between text-indigo-300 font-bold transition-colors cursor-pointer"
              >
                <span>🏢 Pusat (Admin Dashboard)</span>
                <span className="font-mono text-[10px] text-indigo-300">admin / admin123</span>
              </button>

              {/* User Petugas Venues */}
              {(users.length > 0 ? users : INITIAL_USERS)
                .filter((u) => u.role === 'user')
                .map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => selectAccountQuickFill(acc)}
                    className="w-full p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-left flex items-center justify-between transition-colors text-slate-300 cursor-pointer"
                  >
                    <span className="font-semibold text-slate-200">
                      📱 {acc.venue}
                    </span>
                    <span className="font-mono text-[10px] text-sky-400">
                      {acc.username} / {acc.password}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Security watermark badge */}
        <div className="mt-6 flex items-center justify-center gap-2 text-[10px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Tersinkronisasi Real-Time dengan Firebase Firestore</span>
        </div>
      </div>
    </div>
  );
};
