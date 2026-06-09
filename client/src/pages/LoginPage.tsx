import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (pw: string) => {
      const res = await apiRequest("POST", "/api/auth/login", { password: pw });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        onLogin();
      } else {
        setError("Incorrect password. Please try again.");
      }
    },
    onError: () => {
      setError("Incorrect password. Please try again.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMutation.mutate(password);
  };

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-3 mb-2">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Atomic Stays">
              <circle cx="18" cy="18" r="17" stroke="#14b8a6" strokeWidth="2"/>
              <circle cx="18" cy="18" r="4" fill="#14b8a6"/>
              <ellipse cx="18" cy="18" rx="13" ry="5.5" stroke="#14b8a6" strokeWidth="1.5" fill="none"/>
              <ellipse cx="18" cy="18" rx="13" ry="5.5" stroke="#14b8a6" strokeWidth="1.5" fill="none" transform="rotate(60 18 18)"/>
              <ellipse cx="18" cy="18" rx="13" ry="5.5" stroke="#14b8a6" strokeWidth="1.5" fill="none" transform="rotate(120 18 18)"/>
            </svg>
            <div>
              <div className="text-white font-semibold text-lg leading-tight">Atomic Stays</div>
              <div className="text-[#14b8a6] text-xs font-medium tracking-widest uppercase">Listing Manager</div>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-[#1a2535] border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h1 className="text-white text-xl font-semibold mb-1">Team Access</h1>
          <p className="text-slate-400 text-sm mb-6">Enter the team password to continue</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Team password"
                autoFocus
                className="w-full bg-[#0f1923] border border-white/10 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#14b8a6] focus:ring-1 focus:ring-[#14b8a6] transition-colors"
              />
              {error && (
                <p className="text-red-400 text-xs mt-2">{error}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending || !password}
              className="w-full bg-[#14b8a6] hover:bg-[#0d9488] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg text-sm transition-colors"
            >
              {loginMutation.isPending ? "Verifying..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Atomic Stays · Internal Operations Tool
        </p>
      </div>
    </div>
  );
}
