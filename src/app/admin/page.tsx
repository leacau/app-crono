"use client";

import { useEffect, useState } from "react";

import { supabase } from "../../lib/supabaseClient";
import { useRouter } from "next/navigation";

type Race = {
  id: number;
  name: string;
  date: string | null;
  location: string | null;
  status: string | null;
};

export default function AdminHomePage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const [races, setRaces] = useState<Race[]>([]);
  const [raceId, setRaceId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  // chequeo de "soy admin"
  useEffect(() => {
    try {
      const flag = window.localStorage.getItem("isAdminCrono");
      if (flag === "1") {
        setAllowed(true);
      } else {
        setAllowed(false);
      }
    } catch (e) {
        console.error(e);
        setAllowed(false);
    }
  }, []);

  // cargo carreras cuando ya sé si tengo permiso
  useEffect(() => {
    if (allowed !== true) return;
    (async () => {
      setErr("");
      const { data, error } = await supabase
        .from("races")
        .select("id,name,date,location,status")
        .order("date", { ascending: false });
      if (error) {
        console.error(error);
        setErr("No se pudieron cargar las carreras.");
        setRaces([]);
      } else {
        setRaces((data || []) as Race[]);
      }
    })();
  }, [allowed]);

  function goWhere(path: "participants" | "categories" | "timing" | "results") {
    if (!raceId) return;
    router.push(`/race/${raceId}/${path}`);
  }

  if (allowed === null) {
    // Todavía chequeando localStorage
    return (
      <main className="min-h-screen bg-neutral-950 text-white p-6 flex items-center justify-center">
        <div className="text-neutral-400 text-sm">Verificando acceso…</div>
      </main>
    );
  }

  if (allowed === false) {
    // No tiene la flag -> no entra
    return (
      <main className="min-h-screen bg-neutral-950 text-white p-6 flex items-center justify-center">
        <div className="w-full max-w-sm border border-neutral-800 bg-neutral-900 rounded-2xl p-6 text-center">
          <div className="text-xl font-bold text-white mb-2">
            Acceso restringido
          </div>
          <div className="text-neutral-400 text-sm mb-4">
            Esta sección es sólo para la organización.
          </div>
          <button
            className="w-full bg-neutral-800 border border-neutral-600 text-white font-semibold px-4 py-2 rounded-lg text-sm active:scale-95"
            onClick={() => router.push("/admin-login")}
          >
            Ir a login admin
          </button>
        </div>
      </main>
    );
  }

  // allowed === true
  return (
    <main className="min-h-screen bg-neutral-950 text-white p-6 flex items-center justify-center">
      <div className="w-full max-w-xl border border-neutral-800 bg-neutral-900 rounded-2xl p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-white">
            Panel de Administración
          </h1>
          <p className="text-neutral-400 text-sm">
            Gestión interna. Cronometraje, categorías, participantes.
          </p>
        </div>

        {/* elegir carrera */}
        <div className="mt-6">
          <label className="text-sm text-neutral-300">Carrera</label>
          <div className="mt-2">
            {err && (
              <div className="text-red-400 text-sm mb-2">{err}</div>
            )}

            {races.length === 0 ? (
              <div className="text-neutral-500 text-sm">
                No hay carreras.
              </div>
            ) : (
              <select
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
                value={raceId ?? ""}
                onChange={(e) =>
                  setRaceId(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
              >
                <option value="">-- Elegí una carrera --</option>
                {races.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.date ? `· ${r.date}` : ""}{" "}
                    {r.location ? `· ${r.location}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* accesos internos */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            disabled={!raceId}
            onClick={() => goWhere("participants")}
            className="bg-neutral-800 border border-neutral-600 rounded-xl px-4 py-3 text-left disabled:opacity-50 active:scale-95"
          >
            <div className="text-white font-semibold">
              Participantes
            </div>
            <div className="text-[11px] text-neutral-400">
              Carga masiva, limpieza, DNIs, chip, etc.
            </div>
          </button>

          <button
            disabled={!raceId}
            onClick={() => goWhere("categories")}
            className="bg-neutral-800 border border-neutral-600 rounded-xl px-4 py-3 text-left disabled:opacity-50 active:scale-95"
          >
            <div className="text-white font-semibold">
              Categorías
            </div>
            <div className="text-[11px] text-neutral-400">
              Definición por edad/sexo/distancia.
            </div>
          </button>

          <button
            disabled={!raceId}
            onClick={() => goWhere("timing")}
            className="bg-neutral-800 border border-neutral-600 rounded-xl px-4 py-3 text-left disabled:opacity-50 active:scale-95"
          >
            <div className="text-white font-semibold">
              Cronometraje
            </div>
            <div className="text-[11px] text-neutral-400">
              Llegadas en vivo.
            </div>
          </button>

          <button
            disabled={!raceId}
            onClick={() => goWhere("results")}
            className="bg-neutral-800 border border-neutral-600 rounded-xl px-4 py-3 text-left disabled:opacity-50 active:scale-95"
          >
            <div className="text-white font-semibold">
              Clasificación
            </div>
            <div className="text-[11px] text-neutral-400">
              Resultados ordenados.
            </div>
          </button>
        </div>

        {/* logout admin */}
        <div className="mt-8 text-center">
          <button
            onClick={() => {
              try {
                window.localStorage.removeItem("isAdminCrono");
              } catch (e) {
                console.error(e);
              }
              setAllowed(false);
            }}
            className="text-[11px] text-red-400 underline"
          >
            Salir modo admin
          </button>
        </div>

        <div className="mt-4 text-[11px] text-neutral-600 text-center">
          Acceso protegido solo para staff.  
          No compartir la clave con corredores.
        </div>
      </div>
    </main>
  );
}
