"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle, Loader2, User, ShieldCheck, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UserResult {
  email: string;
  password: string;
  role: string;
  name: string;
  status: "pending" | "success" | "error";
  message?: string;
}

const TEST_USERS: Omit<UserResult, "status">[] = [
  { email: "admin@cartela.com", password: "Admin@123456", role: "admin", name: "Admin User" },
  { email: "sales1@cartela.com", password: "Sales@123456", role: "sales", name: "أمير مصطفى" },
  { email: "sales2@cartela.com", password: "Sales@123456", role: "sales", name: "محمد عبدالمعطي" },
];

export default function SetupPage() {
  const [results, setResults] = useState<UserResult[]>(
    TEST_USERS.map((u) => ({ ...u, status: "pending" }))
  );
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const createTestUsers = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/setup", { method: "POST" });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setLoading(false);
        return;
      }

      // Update results from API response
      const updatedResults = TEST_USERS.map((user) => {
        const result = data.results?.find((r: any) => r.email === user.email);
        return {
          ...user,
          status: result?.status === "success" ? ("success" as const) : ("error" as const),
          message: result?.message,
        };
      });

      setResults(updatedResults);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "Network error. Make sure the dev server is running.");
    }

    setLoading(false);
  };

  const allSuccess = results.every((r) => r.status === "success");

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-950 dark:to-blue-950 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8 w-full max-w-md"
      >
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-500 mb-4">
            <ShieldCheck className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Create Test Users
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            One-click setup for demo accounts
          </p>
        </div>

        {/* Users */}
        <div className="space-y-3 mb-6">
          {results.map((user, i) => (
            <motion.div
              key={user.email}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                user.status === "success"
                  ? "border-green-200 bg-green-50 dark:bg-green-950/20"
                  : user.status === "error"
                  ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                  : "border-gray-200 bg-gray-50 dark:bg-gray-800/50"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  user.role === "admin"
                    ? "bg-blue-100 dark:bg-blue-900/50"
                    : "bg-purple-100 dark:bg-purple-900/50"
                }`}
              >
                <User
                  className={`h-4 w-4 ${
                    user.role === "admin" ? "text-blue-600" : "text-purple-600"
                  }`}
                />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
                  {user.name}{" "}
                  <span
                    className={`text-xs font-normal px-1.5 py-0.5 rounded-full ${
                      user.role === "admin"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    {user.role}
                  </span>
                </p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
                <p className="text-xs font-mono text-gray-400">🔑 {user.password}</p>
                {user.status === "error" && user.message && (
                  <p className="text-xs text-red-500 mt-0.5 truncate">{user.message}</p>
                )}
              </div>

              <div className="shrink-0">
                {user.status === "success" && (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                )}
                {user.status === "error" && (
                  <AlertCircle className="h-5 w-5 text-red-500" />
                )}
                {user.status === "pending" && loading && (
                  <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <p className="font-semibold mb-1">Error:</p>
            <p>{error}</p>
            {error.includes("SERVICE_ROLE") && (
              <p className="mt-2 text-xs">
                Add <code className="bg-red-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> to your <code className="bg-red-100 px-1 rounded">.env.local</code> file.
              </p>
            )}
          </div>
        )}

        {!done ? (
          <Button
            onClick={createTestUsers}
            disabled={loading}
            className="w-full gap-2 h-11"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating users...
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Create Test Users
              </>
            )}
          </Button>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-3"
          >
            <div
              className={`p-3 rounded-xl text-center text-sm font-medium ${
                allSuccess
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-yellow-50 text-yellow-700 border border-yellow-200"
              }`}
            >
              {allSuccess
                ? "✅ All users created! You can now log in."
                : "⚠️ Done — some users may already exist, that's OK!"}
            </div>
            <a href="/login">
              <Button className="w-full h-11 gap-2">
                <ExternalLink className="h-4 w-4" />
                Go to Login
              </Button>
            </a>
          </motion.div>
        )}

        <p className="text-xs text-gray-400 text-center mt-4">
          ⚠️ Development only — remove before production
        </p>
      </motion.div>
    </div>
  );
}
