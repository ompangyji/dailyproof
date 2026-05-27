import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card-brut p-8 space-y-6">
        <header className="text-center">
          <h1 className="font-display text-4xl">DailyProof</h1>
          <p className="font-tag text-electric text-xl mt-1 -rotate-2 inline-block">
            gm! log your day
          </p>
        </header>
        <Suspense fallback={<div className="h-40" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
