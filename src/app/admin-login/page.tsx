"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY || "letmein";

export default function AdminLoginPage() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");

  function handleLogin() {
    // validamos
    if (key.trim() === ADMIN_KEY) {
      // marco admin en localStorage
      try {
        window.localStorage.setItem("isAdminCrono", "1");
      } catch (e) {
        console.error("No se pudo guardar admin flag", e);
      }
      router.push("/admin");
    } else {
      setErr("Clave incorrecta.");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-6 flex items-center justify-center">
      <div className="w-full max-w-sm border border-neutral-800 bg-neutral-900 rounded-2xl p-6">
        <h1 className="text-xl font-bold">Acceso administrador</h1>
        <p className="text-neutral-400 text-sm mt-1">
          Área operativa. Solo personal autorizado.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <label className="text-sm text-neutral-300">
            Clave
            <input
              type="password"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm mt-1"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLogin();
              }}
            />
          </label>

          {err && (
            <div className="text-red-400 text-sm">{err}</div>
          )}

          <button
            onClick={handleLogin}
            className="w-full bg-emerald-600 text-white font-semibold px-4 py-2 rounded-lg text-sm active:scale-95"
          >
            Ingresar
          </button>
        </div>

        <div className="mt-4 text-[11px] text-neutral-600">
          Si no sabés la clave, esta sección no es para vos 🙂
        </div>
      </div>
    </main>
  );
}
