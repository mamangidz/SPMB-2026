import React, { useState } from 'react';
import { Lock, User, ArrowRight, ShieldCheck, ShieldAlert } from 'lucide-react';
import { UserAccount } from '../types';
import { INITIAL_USERS } from '../data/initialData';

interface LoginFormProps {
  users: UserAccount[];
  onLogin: (user: UserAccount) => void;
  isLoading?: boolean;
}

export const LoginForm: React.FC<LoginFormProps> = ({ users, onLogin, isLoading }) => {
  // Form user login setiap venue dengan input kosong secara default
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanUsername || !cleanPassword) {
      setErrorMessage('Harap isi username dan password Anda.');
      return;
    }

    // 1. Direct admin check: Always allow admin login (accepts both admin123 and admin)
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

        {/* Security watermark badge */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-center gap-2 text-[10px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Tersinkronisasi Real-Time dengan Firebase Firestore</span>
        </div>
      </div>
    </div>
  );
};
