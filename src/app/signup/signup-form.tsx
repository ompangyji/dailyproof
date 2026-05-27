"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data.session) {
      router.replace("/");
      router.refresh();
    } else {
      setInfo("Confirmation email sent. Verify your email, then sign in.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-bold mb-1.5">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-brut"
          autoComplete="email"
        />
      </div>
      <div>
        <label className="block text-sm font-bold mb-1.5">Password (min 6 chars)</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-brut"
          autoComplete="new-password"
        />
      </div>
      {error && (
        <p className="text-sm font-bold text-coral border-2 border-coral bg-coral/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {info && (
        <p className="text-sm font-bold text-ink border-2 border-ink bg-lime rounded-lg px-3 py-2">
          {info}
        </p>
      )}
      <button type="submit" disabled={loading} className="btn-brut btn-primary w-full justify-center">
        {loading ? "Creating…" : "Create account"}
      </button>
      <p className="text-center text-sm text-ink/70">
        Already have one?{" "}
        <Link href="/login" className="font-bold text-electric underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
