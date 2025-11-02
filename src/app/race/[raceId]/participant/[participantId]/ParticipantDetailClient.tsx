'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../../lib/supabaseClient';

// -------------------------------------------------------
// Tipos
// -------------------------------------------------------
type Race = {
  id: number;
  name: string;
  date: string | null;
  location: string | null;
  status: string | null;
};

type Participant = {
  id: number;
  race_id: number;
  bib_number: number | null;
  chip: string | null;
  first_name: string;
  last_name: string;
  dni: string;
  sex: string;
  birth_date: string | null;
  age: number | null;
  distance_km: number | null;
  status: string | null;
  category_id: number | null;
  category: { name: string } | null;
  chip_delivered: boolean | null;
  kit_delivered: boolean | null;
};

export default function ParticipantDetailClient({
  raceId,
  participantId,
}: {
  raceId: string;
  participantId: string;
}) {
  const router = useRouter();

  // normalizamos a number para las queries
  const raceIdNum = Number(raceId);
  const participantIdNum = Number(participantId);

  // estado de carga
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');

  // carrera (para encabezado, breadcrumb)
  const [race, setRace] = useState<Race | null>(null);

  // participante
  const [p, setP] = useState<Participant | null>(null);

  // flags de guardado toggle
  const [savingChip, setSavingChip] = useState(false);
  const [savingKit, setSavingKit] = useState(false);

  // -------------------------------------------------------
  // Cargar datos
  // -------------------------------------------------------
  const loadData = useCallback(async () => {
    setLoading(true);
    setErrMsg('');

    // 1. Traer carrera
    const { data: rdata, error: rerr } = await supabase
      .from('races')
      .select('id,name,date,location,status')
      .eq('id', raceIdNum)
      .single();

    if (rerr) {
      console.error('Error race:', rerr);
      setRace(null);
      setErrMsg(rerr.message || 'No se pudo cargar la carrera.');
      setLoading(false);
      return;
    } else {
      setRace(rdata as Race);
    }

    // 2. Traer participante puntual
    // IMPORTANTE: estás pidiendo chip_delivered y kit_delivered.
    // Esto tiene que existir en la tabla "participants".
    // Si no existe, o la migración no corrió, va a tirar 42703.
    const { data: pdata, error: perr } = await supabase
      .from('participants')
      .select(
        `
        id,
        race_id,
        bib_number,
        chip,
        first_name,
        last_name,
        dni,
        sex,
        birth_date,
        age,
        distance_km,
        status,
        category_id,
        category:categories ( name ),
        chip_delivered,
        kit_delivered
      `
      )
      .eq('id', participantIdNum)
      .eq('race_id', raceIdNum)
      .single();

    if (perr) {
      console.error('Error participant:', perr);
      setP(null);
      // si vuelve 42703 es porque la tabla no tiene las columnas
      const friendly =
        perr.code === '42703'
          ? 'Faltan columnas chip_delivered / kit_delivered en participants. Tenés que agregarlas en la DB.'
          : perr.message ||
            'No se pudo cargar el participante solicitado. Verificá el ID.';
      setErrMsg(friendly);
      setLoading(false);
      return;
    }

    // normalizar category si viene como array
    const normalizedParticipant: Participant = {
      ...pdata,
      category:
        pdata.category && Array.isArray(pdata.category)
          ? pdata.category[0] ?? null
          : pdata.category ?? null,
    };

    setP(normalizedParticipant);
    setLoading(false);
  }, [raceIdNum, participantIdNum]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -------------------------------------------------------
  // Handlers de toggles (Chip entregado / Kit entregado)
  // -------------------------------------------------------

  async function toggleChipDelivered() {
    if (!p) return;
    const newVal = !p.chip_delivered;
    setSavingChip(true);

    const { error } = await supabase
      .from('participants')
      .update({ chip_delivered: newVal })
      .eq('id', p.id)
      .eq('race_id', p.race_id);

    if (error) {
      console.error('Error update chip_delivered:', error);
      alert('No se pudo actualizar el estado de entrega de chip.');
      setSavingChip(false);
      return;
    }

    setP({
      ...p,
      chip_delivered: newVal,
    });
    setSavingChip(false);
  }

  async function toggleKitDelivered() {
    if (!p) return;
    const newVal = !p.kit_delivered;
    setSavingKit(true);

    const { error } = await supabase
      .from('participants')
      .update({ kit_delivered: newVal })
      .eq('id', p.id)
      .eq('race_id', p.race_id);

    if (error) {
      console.error('Error update kit_delivered:', error);
      alert('No se pudo actualizar el estado de entrega de kit.');
      setSavingKit(false);
      return;
    }

    setP({
      ...p,
      kit_delivered: newVal,
    });
    setSavingKit(false);
  }

  // -------------------------------------------------------
  // Render de estados base
  // -------------------------------------------------------

  if (loading && !p) {
    return (
      <main className="min-h-screen bg-neutral-950 text-white p-4 flex flex-col gap-4">
        <div className="text-neutral-400 text-sm">
          Cargando ficha del participante...
        </div>
      </main>
    );
  }

  if (!p || !race) {
    return (
      <main className="min-h-screen bg-neutral-950 text-white p-4">
        <div className="text-red-400 text-sm bg-red-950/30 border border-red-700 rounded-lg px-3 py-2 mb-4">
          {errMsg || 'No se pudo cargar la información solicitada.'}
        </div>

        <button
          className="bg-neutral-800 border border-neutral-600 rounded-lg px-4 py-2 text-white text-sm active:scale-95"
          onClick={() => router.push(`/race/${raceIdNum}/participants`)}
        >
          ← Volver a participantes
        </button>
      </main>
    );
  }

  // -------------------------------------------------------
  // Helpers de display
  // -------------------------------------------------------

  const fullName = `${p.last_name}, ${p.first_name}`;
  const categoriaName =
    p.category && p.category.name ? p.category.name : '—';
  const distanciaTxt =
    p.distance_km != null ? `${p.distance_km}K` : '—';
  const dorsalTxt = p.bib_number != null ? p.bib_number : '—';
  const chipTxt = p.chip || '—';
  const edadTxt = p.age != null ? p.age : '—';
  const birthTxt = p.birth_date || '—';
  const statusTxt = p.status || '—';

  // -------------------------------------------------------
  // Render principal
  // -------------------------------------------------------

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-4 pb-24">
      {/* HEADER / MIGAS */}
      <div className="flex flex-col gap-1 mb-4">
        <div className="text-sm text-neutral-400 flex items-center gap-2 flex-wrap">
          <button
            className="underline text-neutral-300"
            onClick={() => router.push(`/admin`)}
          >
            ← Admin
          </button>

          <span className="text-neutral-600">/</span>

          <button
            className="underline text-neutral-300"
            onClick={() => router.push(`/race/${raceIdNum}`)}
          >
            {race.name}
          </button>

          <span className="text-neutral-600">/</span>

          <button
            className="underline text-neutral-300"
            onClick={() => router.push(`/race/${raceIdNum}/participants`)}
          >
            Participantes
          </button>

          <span className="text-neutral-600">/</span>

          <span className="text-neutral-200 font-semibold">
            #{p.id}
          </span>
        </div>

        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight break-words">
            {fullName}
          </h1>

          <div className="text-sm text-neutral-400">
            {race.date} · {race.location || 'Sin ubicación'}
          </div>

          <div className="text-[11px] text-neutral-500 mt-1">
            Estado carrera:{' '}
            <span
              className={
                race.status === 'open'
                  ? 'text-emerald-400'
                  : race.status === 'closed'
                  ? 'text-red-400'
                  : 'text-neutral-300'
              }
            >
              {race.status || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* BLOQUE PRINCIPAL DEL PARTICIPANTE */}
      <section className="bg-neutral-900 border border-neutral-700 rounded-2xl p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold text-white leading-tight">
              Datos del participante
            </div>
            <div className="text-[11px] text-neutral-500 leading-tight">
              Información operativa para acreditación, clasificación y
              premiación.
            </div>
          </div>

          <div className="flex-shrink-0 flex flex-col items-end text-right">
            <div className="text-[11px] text-neutral-500 uppercase tracking-wide">
              Dorsal
            </div>
            <div className="text-2xl font-semibold text-white leading-none">
              {dorsalTxt}
            </div>

            <div className="text-[10px] text-neutral-500 mt-1 leading-tight">
              Chip:
              <span className="text-neutral-200 ml-1">{chipTxt}</span>
            </div>
          </div>
        </div>

        {/* GRID DE INFO */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-[13px] text-neutral-200">
          <InfoField label="Apellido, Nombre" value={fullName} />
          <InfoField label="DNI" value={p.dni || '—'} />
          <InfoField label="Sexo" value={p.sex || '—'} />

          <InfoField label="Edad" value={String(edadTxt)} />
          <InfoField label="Nacimiento" value={birthTxt} />
          <InfoField label="Distancia" value={distanciaTxt} />

          <InfoField label="Categoría" value={categoriaName} />
          <InfoField label="Estado" value={statusTxt} />
          <InfoField label="ID interno" value={`#${p.id}`} />
        </div>
      </section>

      {/* BLOQUE CHECKS DE ENTREGA (Chip / Kit) */}
      <section className="bg-neutral-900 border border-neutral-700 rounded-2xl p-4 mb-6">
        <div className="text-lg font-semibold text-white leading-tight">
          Acreditación / Entregas
        </div>
        <div className="text-[11px] text-neutral-500 leading-tight mb-4">
          Uso en mesa de entrega. Tocar para marcar recibido.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
          {/* CHIP ENTREGADO */}
          <div className="flex items-start gap-3 bg-neutral-800 border border-neutral-600 rounded-xl p-3">
            <label className="flex items-start gap-3 w-full cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5 rounded-md border-neutral-500 bg-neutral-900 accent-emerald-600 cursor-pointer"
                checked={!!p.chip_delivered}
                disabled={savingChip}
                onChange={toggleChipDelivered}
              />
              <div className="flex-1">
                <div className="text-white font-semibold leading-tight">
                  Chip entregado
                </div>
                <div className="text-[11px] text-neutral-400 leading-tight">
                  Registra si se llevó su chip. Esto impacta en control
                  de largada y cronometraje.
                </div>
                {savingChip && (
                  <div className="text-[11px] text-blue-400 mt-1">
                    Guardando...
                  </div>
                )}
              </div>
            </label>
          </div>

          {/* KIT ENTREGADO */}
          <div className="flex items-start gap-3 bg-neutral-800 border border-neutral-600 rounded-xl p-3">
            <label className="flex items-start gap-3 w-full cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5 rounded-md border-neutral-500 bg-neutral-900 accent-emerald-600 cursor-pointer"
                checked={!!p.kit_delivered}
                disabled={savingKit}
                onChange={toggleKitDelivered}
              />
              <div className="flex-1">
                <div className="text-white font-semibold leading-tight">
                  Kit entregado
                </div>
                <div className="text-[11px] text-neutral-400 leading-tight">
                  Remera, número, bolsa, folletos, etc.
                </div>
                {savingKit && (
                  <div className="text-[11px] text-blue-400 mt-1">
                    Guardando...
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>

        <div className="text-[10px] text-neutral-500 leading-tight mt-4">
          Nota: estos switches escriben directamente en la base para
          este corredor. No requieren panel admin.
        </div>
      </section>

      {/* BOTONES FINALES */}
      <section className="flex flex-col sm:flex-row sm:justify-between gap-3">
        <button
          className="bg-neutral-800 border border-neutral-600 rounded-lg px-4 py-2 text-[13px] text-white font-semibold active:scale-95"
          onClick={() => router.push(`/race/${raceIdNum}/participants`)}
        >
          ← Volver al listado
        </button>

        <button
          className="bg-neutral-800 border border-neutral-600 rounded-lg px-4 py-2 text-[13px] text-white active:scale-95"
          onClick={loadData}
        >
          Recargar datos ↻
        </button>
      </section>

      <div className="text-[10px] text-neutral-600 mt-6 leading-tight">
        Esta ficha está pensada para usarse también desde el celu en
        acreditación. Si no ves los datos actualizados después de
        tildar, tocá "Recargar datos".
      </div>
    </main>
  );
}

// -------------------------------------------------------
// Subcomponente de visualización de campo
// -------------------------------------------------------
function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <div className="text-[11px] text-neutral-400 uppercase tracking-wide leading-tight">
        {label}
      </div>
      <div className="text-[13px] text-neutral-200 font-semibold leading-tight break-words">
        {value}
      </div>
    </div>
  );
}
