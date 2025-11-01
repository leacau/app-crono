'use client';

import { use, useEffect, useState } from 'react';

import { supabase } from '../../../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

type ParticipantRow = {
	id: number;
	bib_number: string | null;
	first_name: string;
	last_name: string;
};

type LastLog = {
	id: number;
	bib_number: string | null;
	name: string;
	timestamp_utc: string;
	elapsed_ms: number;
};

export default function TimerPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const router = useRouter();
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);

	// estado UI
	const [bibInput, setBibInput] = useState('');
	const [saving, setSaving] = useState(false);
	const [errMsg, setErrMsg] = useState('');

	// últimas llegadas registradas
	const [recentLogs, setRecentLogs] = useState<LastLog[]>([]);

	// Cargar ultimas llegadas
	async function loadRecent() {
		// Traemos los últimos 10 timelogs de esta carrera
		// y unimos con participants para mostrar nombre + dorsal
		const { data, error } = await supabase
			.from('timelogs')
			.select(
				`
        id,
        participant_id,
        timestamp_utc,
        elapsed_ms,
        participant:participant_id (
          bib_number,
          first_name,
          last_name
        )
      `
			)
			.eq('race_id', raceId)
			.order('timestamp_utc', { ascending: false })
			.limit(10);

		if (error) {
			console.error('Error cargando llegadas:', error);
			return;
		}

		const mapped = (data || []).map((row: any) => ({
			id: row.id,
			bib_number: row.participant?.bib_number ?? null,
			name: `${row.participant?.last_name?.toUpperCase() || ''}, ${
				row.participant?.first_name || ''
			}`.trim(),
			timestamp_utc: row.timestamp_utc,
			elapsed_ms: row.elapsed_ms,
		}));

		setRecentLogs(mapped);
	}

	useEffect(() => {
		loadRecent();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// Buscar participante por dorsal
	async function findParticipantByBib(
		bib: string
	): Promise<ParticipantRow | null> {
		const { data, error } = await supabase
			.from('participants')
			.select('id, bib_number, first_name, last_name')
			.eq('race_id', raceId)
			.eq('bib_number', bib)
			.limit(1)
			.maybeSingle();

		if (error) {
			console.error('Error buscando dorsal:', error);
			return null;
		}

		return data as ParticipantRow | null;
	}

	// Registrar llegada
	async function handleMarkArrival() {
		setErrMsg('');

		const bib = bibInput.trim();
		if (!bib) {
			setErrMsg('Ingresá un dorsal.');
			return;
		}

		setSaving(true);

		// 1. Buscar quién es ese dorsal
		const participant = await findParticipantByBib(bib);

		if (!participant) {
			setErrMsg(`No se encontró el dorsal ${bib}.`);
			setSaving(false);
			return;
		}

		// 2. Tomamos tiempo actual en ms
		const nowMs = Date.now();

		// 3. Insertar en timelogs
		const { error: insertErr } = await supabase.from('timelogs').insert([
			{
				race_id: raceId,
				participant_id: participant.id,
				elapsed_ms: nowMs,
				type: 'finish',
				source: 'manual',
				notes: null,
			},
		]);

		if (insertErr) {
			console.error('Error guardando tiempo:', insertErr);
			setErrMsg('No se pudo guardar el tiempo.');
			setSaving(false);
			return;
		}

		// Limpieza rápida
		setBibInput('');
		setSaving(false);

		// Recargar últimos
		loadRecent();
	}

	return (
		<main className='min-h-screen bg-neutral-950 text-white p-4 pb-24 flex flex-col gap-4'>
			{/* Header con volver */}
			<div className='flex items-start justify-between'>
				<div className='flex flex-col gap-1'>
					<button
						className='text-neutral-300 underline text-sm'
						onClick={() => router.push(`/race/${raceId}`)}
					>
						← Volver carrera #{raceId}
					</button>

					<h1 className='text-2xl font-bold'>Llegadas</h1>
					<p className='text-sm text-neutral-400'>
						Marcá dorsal cuando cruza el arco
					</p>
				</div>
			</div>

			{/* Input + botón grande */}
			<div className='flex flex-col gap-3'>
				<label className='flex flex-col gap-1 text-sm'>
					<span>Dorsal</span>
					<input
						className='rounded-xl bg-neutral-800 border border-neutral-600 px-4 py-4 text-white text-2xl font-semibold tracking-wide text-center'
						placeholder='154'
						value={bibInput}
						onChange={(e) => setBibInput(e.target.value)}
						disabled={saving}
						autoFocus
					/>
				</label>

				{errMsg && <div className='text-red-400 text-sm'>{errMsg}</div>}

				<button
					className='w-full bg-emerald-600 text-white font-semibold text-xl px-4 py-4 rounded-xl active:scale-95 disabled:opacity-50 disabled:active:scale-100'
					disabled={saving}
					onClick={handleMarkArrival}
				>
					{saving ? 'Guardando...' : 'Marcar llegada'}
				</button>
			</div>

			{/* Últimas llegadas */}
			<section className='mt-6'>
				<div className='text-lg font-semibold mb-2'>Últimas llegadas</div>

				{recentLogs.length === 0 ? (
					<div className='text-neutral-400 text-sm'>
						Todavía no hay llegadas cargadas.
					</div>
				) : (
					<ul className='flex flex-col gap-2 text-sm'>
						{recentLogs.map((log) => (
							<li
								key={log.id}
								className='rounded-lg border border-neutral-700 bg-neutral-900 p-3 flex flex-col'
							>
								<div className='flex justify-between'>
									<div className='font-semibold'>
										#{log.bib_number || 's/d'} {log.name}
									</div>
									<div className='text-neutral-400 text-xs'>
										{log.timestamp_utc}
									</div>
								</div>
								<div className='text-neutral-400 text-xs mt-1'>
									raw ms: {log.elapsed_ms}
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}
